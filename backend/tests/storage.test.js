/**
 * storage.test.js — unit tests for storage.js
 * Covers: local disk mode (no AWS credentials) and S3 mode (mocked AWS SDK)
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
      S3Client:         jest.fn(() => ({ send: mockSend })),
      PutObjectCommand: jest.fn(input => input),
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
      S3Client:         jest.fn(() => ({ send: localSend })),
      PutObjectCommand: jest.fn(input => input),
    }));
    const s = require('../storage');
    const result = await s.saveFile(mockFile);
    expect(result).toContain('us-east-1');
    process.env.AWS_REGION = 'ap-south-1'; // restore
  });
});
