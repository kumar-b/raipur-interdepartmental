require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');

const departmentsRouter  = require('./routes/departments');
const noticesRouter      = require('./routes/notices');
const contactRouter      = require('./routes/contact');
const authRouter         = require('./routes/auth');
const noticesAuthRouter  = require('./routes/notices-auth');
const usersRouter        = require('./routes/users');

const { isS3 } = require('./storage');

const app = express();

app.use(cors({ exposedHeaders: ['Authorization'] }));
app.use(express.json());

// Serve uploaded files from local disk only when not using S3.
// In S3 mode, files are accessed directly via their S3 URL.
if (!isS3) {
  app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
}

app.use(express.static(path.join(__dirname, '../frontend')));

// Public API
app.use('/api/departments', departmentsRouter);
app.use('/api/notices',     noticesRouter);
app.use('/api/contact',     contactRouter);

// Authenticated API
app.use('/api/auth',   authRouter);
app.use('/api/portal', noticesAuthRouter);
app.use('/api/portal', usersRouter);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

module.exports = app;
