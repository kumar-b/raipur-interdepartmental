/**
 * storage.js — unified file storage for notice attachments and reply files.
 *
 * Supports two backends selected automatically via environment variables:
 *
 *   S3 mode   — if AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_S3_BUCKET
 *               are all set, files are uploaded to the specified S3 bucket and
 *               a public HTTPS URL is returned.
 *
 *   Local mode — if any of the above env vars is missing, files are written to
 *               the /uploads folder next to this module and a relative URL
 *               (/uploads/<filename>) is returned. Express serves this folder
 *               as a static asset when not in S3 mode (see app.js).
 *
 * Exports:
 *   saveFile(file)    — persist an uploaded multer file; returns path/URL
 *   deleteFile(path)  — remove a previously saved file from disk or S3
 *   isS3              — boolean flag indicating the active storage backend
 */

const fs   = require('fs');
const path = require('path');

// isS3 is truthy only when all three required AWS credentials are present.
// It is also exported so app.js can skip static-file middleware in S3 mode.
const isS3 = !!(
  process.env.AWS_ACCESS_KEY_ID &&
  process.env.AWS_SECRET_ACCESS_KEY &&
  process.env.AWS_S3_BUCKET
);

/**
 * saveFile — persists an uploaded file and returns a URL/path for storage in DB.
 *
 * Generates a unique filename using the current timestamp and a random suffix
 * to prevent collisions and avoid exposing original file names in the URL.
 *
 * @param  {Express.Multer.File} file  — multer file object (must have .buffer
 *                                       since memoryStorage is used in upload.js)
 * @returns {Promise<string>}           — relative local path (/uploads/...) or
 *                                        full S3 HTTPS URL
 */
async function saveFile(file) {
  const ts       = Date.now();                                     // millisecond timestamp
  const rnd      = Math.random().toString(36).slice(2, 8);         // 6-char random suffix
  const ext      = path.extname(file.originalname).toLowerCase();  // preserve original extension
  const filename = `${ts}-${rnd}${ext}`;                          // e.g. 1771477554992-64ue18.pdf

  if (isS3) {
    // Lazy-require the AWS SDK so it is only loaded when S3 is actually configured.
    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
    const region = process.env.AWS_REGION || 'us-east-1';
    const bucket = process.env.AWS_S3_BUCKET;

    const s3 = new S3Client({
      region,
      credentials: {
        accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    });

    // Store all uploads under a consistent prefix inside the bucket.
    const key = `uploads/${filename}`;
    await s3.send(new PutObjectCommand({
      Bucket:      bucket,
      Key:         key,
      Body:        file.buffer,
      ContentType: file.mimetype,
    }));

    // Return the public S3 URL so the browser can download the file directly.
    return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  }

  // ── Local disk fallback ──────────────────────────────────────────────────
  // Ensure uploads directory exists (may be absent on a fresh server deploy).
  const uploadsDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  // Write the in-memory buffer to the uploads directory synchronously.
  const dest = path.join(__dirname, 'uploads', filename);
  fs.writeFileSync(dest, file.buffer);

  // Return a root-relative URL served by Express's static middleware.
  return `/uploads/${filename}`;
}

/**
 * deleteFile — removes a previously saved file from disk or S3.
 *
 * This is the counterpart to saveFile and is called when a notice is closed.
 * Errors are caught and logged as warnings; they do NOT propagate so that a
 * failed file deletion never blocks the database cleanup that follows.
 *
 * Path conventions handled:
 *   Local: '/uploads/1234-abc.pdf'  → backend/uploads/1234-abc.pdf
 *   S3:    'https://bucket.s3.region.amazonaws.com/uploads/1234-abc.pdf'
 *
 * @param  {string|null} filePath — stored path/URL from the database column
 * @returns {Promise<void>}
 */
async function deleteFile(filePath) {
  // No-op for notices that have no attachment or reply file.
  if (!filePath) return;

  try {
    if (isS3 && filePath.startsWith('https://')) {
      // ── S3 deletion ────────────────────────────────────────────────────
      const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
      const region = process.env.AWS_REGION || 'us-east-1';
      const bucket = process.env.AWS_S3_BUCKET;

      const s3 = new S3Client({
        region,
        credentials: {
          accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      });

      // S3 URL format: https://<bucket>.s3.<region>.amazonaws.com/<key>
      // Strip the leading '/' from the pathname to get the object key.
      const key = new URL(filePath).pathname.slice(1);
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } else {
      // ── Local disk deletion ────────────────────────────────────────────
      // filePath is a root-relative URL like '/uploads/1234-abc.pdf'.
      // Extract just the filename to prevent any path-traversal issues.
      const filename  = path.basename(filePath);
      const localPath = path.join(__dirname, 'uploads', filename);
      if (fs.existsSync(localPath)) {
        fs.unlinkSync(localPath);
      }
      // If the file doesn't exist, treat it as already deleted — no error.
    }
  } catch (err) {
    // Log but swallow the error: a missing/unwritable file should not abort
    // the close operation. The DB record will still be cleaned up.
    console.warn(`[storage] deleteFile failed for "${filePath}":`, err.message);
  }
}

module.exports = { saveFile, deleteFile, isS3 };
