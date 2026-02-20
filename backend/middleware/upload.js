/**
 * middleware/upload.js — multer configuration for file attachment uploads.
 *
 * Accepts PDF documents and common image formats up to 10 MB.
 * Files are held in memory (not written to disk by multer itself) so that
 * storage.js can decide whether to save them locally or upload to S3.
 *
 * Usage in route handlers:
 *   upload.single('attachment')  — for notice attachments
 *   upload.single('reply')       — for department reply files
 */

const multer = require('multer');

// Permitted MIME types — restrict to safe, viewable document/image formats.
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

/**
 * fileFilter — called by multer for each incoming file.
 * Accepts the file if its MIME type is in the allow-list; rejects it otherwise.
 * Returning an error to the callback causes multer to respond with 400.
 */
const fileFilter = (req, file, cb) => {
  if (ALLOWED_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only PDF, JPEG, PNG, and WebP files are allowed.'), false);
  }
};

// Always use memoryStorage — saveFile() in storage.js handles
// writing to local disk or uploading to S3.
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB maximum per file
});

module.exports = upload;
