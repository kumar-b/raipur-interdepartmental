/**
 * storage.js — unified file storage for attachments and replies.
 *
 * If AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_S3_BUCKET are all
 * set in the environment, files are uploaded to S3 and an S3 URL is returned.
 * Otherwise files are written to the local /uploads folder.
 */
const fs   = require('fs');
const path = require('path');

const isS3 = !!(
  process.env.AWS_ACCESS_KEY_ID &&
  process.env.AWS_SECRET_ACCESS_KEY &&
  process.env.AWS_S3_BUCKET
);

/**
 * Saves an uploaded file (from multer memoryStorage) and returns the path/URL.
 * @param {Express.Multer.File} file  — multer file object (must have .buffer)
 * @returns {Promise<string>}         — local path or S3 URL
 */
async function saveFile(file) {
  const ts       = Date.now();
  const rnd      = Math.random().toString(36).slice(2, 8);
  const ext      = path.extname(file.originalname).toLowerCase();
  const filename = `${ts}-${rnd}${ext}`;

  if (isS3) {
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

    const key = `uploads/${filename}`;
    await s3.send(new PutObjectCommand({
      Bucket:      bucket,
      Key:         key,
      Body:        file.buffer,
      ContentType: file.mimetype,
    }));

    return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  }

  // Local disk fallback
  const dest = path.join(__dirname, 'uploads', filename);
  fs.writeFileSync(dest, file.buffer);
  return `/uploads/${filename}`;
}

module.exports = { saveFile, isS3 };
