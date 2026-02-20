/**
 * storage.test.js — unit tests for storage.js
 * Covers:
 *   saveFile  — local disk mode and S3 mode (mocked AWS SDK)
 *   deleteFile — local disk mode (unlink) and S3 mode (DeleteObjectCommand)
 */

process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-jwt-secret-for-jest-at-least-32-characters-long-xxx';

const fs = require('fs');

const mockFile = {
  originalname: 'report.pdf',
  mimetype:     'application/pdf',
  buffer:       Buffer.from('fake pdf content'),
};

// ── Local storage mode (default: no AWS env vars in test environment) ─────────
describe('storage — local disk mode', () => {
  // AWS vars are absent in test env → isS3 is false at module load
  const storage = require('../storage');

  test('isS3 is false when AWS credentials are not configured', () => {
    expect(storage.isS3).toBe(false);
  });

  test('saveFile writes buffer to disk and returns a /uploads/ path', async () => {
    const spy    = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    const result = await storage.saveFile(mockFile);

    expect(spy).toHaveBeenCalledTimes(1);
    const [writtenPath, writtenBuffer] = spy.mock.calls[0];
    expect(writtenPath).toContain('uploads');
    expect(writtenBuffer).toEqual(mockFile.buffer);
    expect(result).toMatch(/^\/uploads\/.+\.pdf$/);
    spy.mockRestore();
  });

  test('returned path follows timestamp-random-ext naming pattern', async () => {
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    const result = await storage.saveFile(mockFile);
    expect(result).toMatch(/^\/uploads\/\d+-[a-z0-9]+\.pdf$/);
    jest.restoreAllMocks();
  });

  test('preserves the original file extension in the saved filename', async () => {
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    const pngFile = { ...mockFile, originalname: 'photo.png', mimetype: 'image/png' };
    const result  = await storage.saveFile(pngFile);
    expect(result).toMatch(/\.png$/);
    jest.restoreAllMocks();
  });

  test('each call produces a unique filename', async () => {
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    const [a, b] = await Promise.all([
      storage.saveFile(mockFile),
      storage.saveFile(mockFile),
    ]);
    expect(a).not.toBe(b);
    jest.restoreAllMocks();
  });

  // ── deleteFile — local disk mode ──────────────────────────────────────────

  test('deleteFile calls fs.unlinkSync for an existing local file', async () => {
    // Simulate a file that exists on disk.
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    const unlinkSpy = jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

    await storage.deleteFile('/uploads/1234-abc.pdf');

    expect(unlinkSpy).toHaveBeenCalledTimes(1);
    // The path passed to unlinkSync must point into the uploads directory.
    expect(unlinkSpy.mock.calls[0][0]).toContain('uploads');
    expect(unlinkSpy.mock.calls[0][0]).toContain('1234-abc.pdf');
    jest.restoreAllMocks();
  });

  test('deleteFile does NOT call unlinkSync when the file does not exist', async () => {
    // Simulate a file that is already missing (e.g. manually deleted).
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    const unlinkSpy = jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

    await storage.deleteFile('/uploads/already-gone.pdf');

    expect(unlinkSpy).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  test('deleteFile is a no-op (does not throw) when filePath is null', async () => {
    await expect(storage.deleteFile(null)).resolves.toBeUndefined();
  });

  test('deleteFile is a no-op when filePath is an empty string', async () => {
    await expect(storage.deleteFile('')).resolves.toBeUndefined();
  });

  test('deleteFile does not throw even when unlinkSync throws an error', async () => {
    // Simulate a permission error — deleteFile should swallow it and log a warning.
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(storage.deleteFile('/uploads/locked-file.pdf')).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();

    jest.restoreAllMocks();
  });
});

// ── S3 mode (AWS credentials present, SDK mocked) ────────────────────────────
describe('storage — S3 mode', () => {
  let storageS3;
  const mockSend = jest.fn().mockResolvedValue({});

  beforeAll(() => {
    process.env.AWS_ACCESS_KEY_ID     = 'AKIATEST123';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret-key-abc';
    process.env.AWS_S3_BUCKET         = 'my-test-bucket';
    process.env.AWS_REGION            = 'ap-south-1';

    jest.resetModules();
    jest.doMock('@aws-sdk/client-s3', () => ({
      S3Client:          jest.fn(() => ({ send: mockSend })),
      PutObjectCommand:  jest.fn(input => input),
      // DeleteObjectCommand is needed by deleteFile in S3 mode.
      // Mock it the same way as PutObjectCommand: return the input so tests
      // can inspect what the route code passed to s3.send().
      DeleteObjectCommand: jest.fn(input => input),
    }));

    storageS3 = require('../storage');
  });

  afterAll(() => {
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_S3_BUCKET;
    delete process.env.AWS_REGION;
    jest.resetModules();
    jest.unmock('@aws-sdk/client-s3');
  });

  beforeEach(() => mockSend.mockClear());

  test('isS3 is true when all three AWS credentials are present', () => {
    expect(storageS3.isS3).toBe(true);
  });

  test('saveFile calls S3 send() and returns an HTTPS S3 URL', async () => {
    const result = await storageS3.saveFile(mockFile);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(result).toMatch(
      /^https:\/\/my-test-bucket\.s3\.ap-south-1\.amazonaws\.com\/uploads\/.+\.pdf$/
    );
  });

  test('returned S3 URL contains the configured bucket name', async () => {
    const result = await storageS3.saveFile(mockFile);
    expect(result).toContain('my-test-bucket');
  });

  test('returned S3 URL contains the configured AWS region', async () => {
    const result = await storageS3.saveFile(mockFile);
    expect(result).toContain('ap-south-1');
  });

  test('does not write to local disk when using S3', async () => {
    const spy = jest.spyOn(fs, 'writeFileSync');
    await storageS3.saveFile(mockFile);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test('S3 key is placed under the uploads/ prefix', async () => {
    await storageS3.saveFile(mockFile);
    const sentInput = mockSend.mock.calls[0][0];
    expect(sentInput.Key).toMatch(/^uploads\/.+/);
  });

  test('PutObjectCommand receives correct ContentType', async () => {
    await storageS3.saveFile(mockFile);
    const sentInput = mockSend.mock.calls[0][0];
    expect(sentInput.ContentType).toBe('application/pdf');
  });

  test('falls back to us-east-1 when AWS_REGION is not set', async () => {
    delete process.env.AWS_REGION;
    jest.resetModules();
    const localSend = jest.fn().mockResolvedValue({});
    jest.doMock('@aws-sdk/client-s3', () => ({
      S3Client:            jest.fn(() => ({ send: localSend })),
      PutObjectCommand:    jest.fn(input => input),
      DeleteObjectCommand: jest.fn(input => input),
    }));
    const s = require('../storage');
    const result = await s.saveFile(mockFile);
    expect(result).toContain('us-east-1');
    process.env.AWS_REGION = 'ap-south-1'; // restore
  });

  // ── deleteFile — S3 mode ──────────────────────────────────────────────────
  // The S3 URL stored in the DB looks like:
  //   https://my-test-bucket.s3.ap-south-1.amazonaws.com/uploads/1234-abc.pdf
  // deleteFile must extract the key ("uploads/1234-abc.pdf") and call
  // DeleteObjectCommand with the correct Bucket + Key.

  const S3_FILE_URL =
    'https://my-test-bucket.s3.ap-south-1.amazonaws.com/uploads/1234-abc.pdf';

  test('deleteFile calls S3 send() exactly once for a valid S3 HTTPS URL', async () => {
    await storageS3.deleteFile(S3_FILE_URL);
    // send() must be called once for the DeleteObjectCommand.
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test('deleteFile sends to the correct S3 bucket', async () => {
    await storageS3.deleteFile(S3_FILE_URL);
    // The mocked DeleteObjectCommand returns its input, so mockSend receives
    // the raw { Bucket, Key } object.
    const sentInput = mockSend.mock.calls[0][0];
    expect(sentInput.Bucket).toBe('my-test-bucket');
  });

  test('deleteFile extracts the correct S3 key from the HTTPS URL', async () => {
    await storageS3.deleteFile(S3_FILE_URL);
    const sentInput = mockSend.mock.calls[0][0];
    // pathname of the URL is '/uploads/1234-abc.pdf'; slice(1) removes the leading '/'.
    expect(sentInput.Key).toBe('uploads/1234-abc.pdf');
  });

  test('deleteFile does not touch the local filesystem when using S3', async () => {
    // Neither writeFileSync nor unlinkSync should be called in S3 mode.
    const writeSpy  = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    const unlinkSpy = jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

    await storageS3.deleteFile(S3_FILE_URL);

    expect(writeSpy).not.toHaveBeenCalled();
    expect(unlinkSpy).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  test('deleteFile swallows S3 errors and logs a warning — does not throw', async () => {
    // Simulate a transient S3 failure (e.g. network timeout, permission denied).
    mockSend.mockRejectedValueOnce(new Error('AccessDenied: insufficient permissions'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(storageS3.deleteFile(S3_FILE_URL)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();

    jest.restoreAllMocks();
  });
});
