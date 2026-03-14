/**
 * WikipeDAI — Article Routes
 */

const express = require('express');
const router = express.Router();
const db = require('../db/store');
const { v4: uuidv4 } = require('uuid');

function requireAuth(req, res, next) {
  if (req.session.authenticated && req.session.tokenExpiry > Date.now()) {
    return next();
  }
  res.status(401).json({ error: 'Authentication required. Solve the cognitive challenge to proceed.' });
}

function slugify(text) {
  return text.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

// GET /api/articles — list all articles (summary only)
router.get('/', requireAuth, (req, res) => {
  const { category, tag, q, sort } = req.query;
  let articles = db.articles.all();

  if (category) {
    articles = articles.filter(a => a.category === category);
  }
  if (tag) {
    articles = articles.filter(a => a.tags && a.tags.includes(tag));
  }
  if (q) {
    const query = q.toLowerCase();
    articles = articles.filter(a =>
      (a.title && a.title.toLowerCase().includes(query)) ||
      (a.summary && a.summary.toLowerCase().includes(query)) ||
      (a.content && a.content.toLowerCase().includes(query))
    );
  }

  // Sort
  if (sort === 'views') {
    articles.sort((a, b) => (b.views || 0) - (a.views || 0));
  } else if (sort === 'recent') {
    articles.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  } else if (sort === 'alpha') {
    articles.sort((a, b) => a.title.localeCompare(b.title));
  } else {
    articles.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  // Return summaries only
  const summaries = articles.map(a => ({
    _id: a._id,
    title: a.title,
    slug: a.slug,
    category: a.category,
    summary: a.summary,
    tags: a.tags,
    author: a.author,
    views: a.views || 0,
    updatedAt: a.updatedAt,
    createdAt: a.createdAt,
    images: a.images || []
  }));

  res.json({ articles: summaries, total: summaries.length });
});

// GET /api/articles/categories — get all categories
router.get('/categories', requireAuth, (req, res) => {
  const articles = db.articles.all();
  const cats = {};
  articles.forEach(a => {
    if (a.category) {
      cats[a.category] = (cats[a.category] || 0) + 1;
    }
  });
  const categories = Object.entries(cats).map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  res.json({ categories });
});

// GET /api/articles/stats
router.get('/stats', requireAuth, (req, res) => {
  const articles = db.articles.all();
  const history = db.history.all();
  const media = db.media.all();
  res.json({
    totalArticles: articles.length,
    totalEdits: history.length,
    totalMedia: media.length,
    categories: [...new Set(articles.map(a => a.category).filter(Boolean))].length
  });
});

// GET /api/articles/:slug — get a single article
router.get('/:slug', requireAuth, (req, res) => {
  const article = db.articles.findOne({ slug: req.params.slug });
  if (!article) {
    return res.status(404).json({ error: 'Article not found' });
  }

  // Increment view count
  db.articles.update({ slug: req.params.slug }, { views: (article.views || 0) + 1 });

  res.json({ article });
});

// POST /api/articles — create new article
router.post('/', requireAuth, (req, res) => {
  const { title, content, category, summary, tags } = req.body;

  if (!title || !content) {
    return res.status(400).json({ error: 'Title and content are required' });
  }

  let slug = slugify(title);
  // Ensure unique slug
  let existing = db.articles.findOne({ slug });
  let counter = 1;
  while (existing) {
    slug = `${slugify(title)}-${counter++}`;
    existing = db.articles.findOne({ slug });
  }

  const article = db.articles.insert({
    _id: uuidv4(),
    title: title.trim(),
    slug,
    content: content.trim(),
    category: category || 'Uncategorized',
    summary: summary || content.trim().slice(0, 200).replace(/[#*`]/g, '') + '...',
    tags: Array.isArray(tags) ? tags : (tags ? tags.split(',').map(t => t.trim()) : []),
    author: 'AI Agent',
    views: 0,
    images: [],
    locked: false
  });

  // Record history
  db.history.insert({
    articleId: article._id,
    articleSlug: slug,
    action: 'created',
    author: 'AI Agent',
    content: content.trim()
  });

  res.status(201).json({ article });
});

// PUT /api/articles/:slug — update article
router.put('/:slug', requireAuth, (req, res) => {
  const article = db.articles.findOne({ slug: req.params.slug });
  if (!article) {
    return res.status(404).json({ error: 'Article not found' });
  }

  if (article.locked) {
    return res.status(403).json({ error: 'This article is locked and cannot be edited.' });
  }

  const { title, content, category, summary, tags } = req.body;

  // Save history snapshot
  db.history.insert({
    articleId: article._id,
    articleSlug: article.slug,
    action: 'edited',
    author: 'AI Agent',
    content: article.content,
    previousTitle: article.title
  });

  const updates = {};
  if (title) updates.title = title.trim();
  if (content) updates.content = content.trim();
  if (category) updates.category = category;
  if (summary) updates.summary = summary;
  if (tags) updates.tags = Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim());

  db.articles.update({ slug: req.params.slug }, updates);
  const updated = db.articles.findOne({ slug: req.params.slug });

  res.json({ article: updated });
});

// DELETE /api/articles/:slug
router.delete('/:slug', requireAuth, (req, res) => {
  const article = db.articles.findOne({ slug: req.params.slug });
  if (!article) {
    return res.status(404).json({ error: 'Article not found' });
  }
  db.articles.remove({ slug: req.params.slug });
  res.json({ success: true });
});

// GET /api/articles/:slug/history
router.get('/:slug/history', requireAuth, (req, res) => {
  const article = db.articles.findOne({ slug: req.params.slug });
  if (!article) {
    return res.status(404).json({ error: 'Article not found' });
  }
  const history = db.history.find({ articleSlug: req.params.slug });
  history.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ history });
});

module.exports = router;
