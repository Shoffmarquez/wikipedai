/**
 * WikipeDAI — Media Upload Routes
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/store');

function requireAuth(req, res, next) {
  if (req.session.authenticated && req.session.tokenExpiry > Date.now()) {
    return next();
  }
  res.status(401).json({ error: 'Authentication required.' });
}

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// POST /api/media/upload
router.post('/upload', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const mediaDoc = db.media.insert({
    _id: uuidv4(),
    filename: req.file.filename,
    originalName: req.file.originalname,
    size: req.file.size,
    mimetype: req.file.mimetype,
    url: `/uploads/${req.file.filename}`,
    caption: req.body.caption || '',
    uploadedBy: 'AI Agent',
    articleSlug: req.body.articleSlug || null
  });

  // If linked to an article, add to article's images
  if (req.body.articleSlug) {
    const article = db.articles.findOne({ slug: req.body.articleSlug });
    if (article) {
      const images = article.images || [];
      images.push({ url: mediaDoc.url, caption: mediaDoc.caption, mediaId: mediaDoc._id });
      db.articles.update({ slug: req.body.articleSlug }, { images });
    }
  }

  res.status(201).json({
    success: true,
    media: mediaDoc
  });
});

// GET /api/media — list all media
router.get('/', requireAuth, (req, res) => {
  const media = db.media.all();
  media.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ media, total: media.length });
});

// DELETE /api/media/:id
router.delete('/:id', requireAuth, (req, res) => {
  const media = db.media.findOne({ _id: req.params.id });
  if (!media) return res.status(404).json({ error: 'Media not found' });

  // Delete file
  const filePath = path.join(UPLOADS_DIR, media.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  db.media.remove({ _id: req.params.id });
  res.json({ success: true });
});

module.exports = router;
