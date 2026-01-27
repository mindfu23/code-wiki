/**
 * Code Wiki - Frontend Application
 */

// State
let wikiIndex = null;
let currentPage = 'search';
let currentCategory = null;
let currentDocument = null;

// DOM Elements
const app = document.getElementById('app');
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const searchResults = document.getElementById('search-results');
const filterCategory = document.getElementById('filter-category');
const filterLanguage = document.getElementById('filter-language');
const categoriesContainer = document.getElementById('categories-container');
const categoryContent = document.getElementById('category-content');
const reposContainer = document.getElementById('repos-container');
const repoStatusFilter = document.getElementById('repo-status-filter');
const repoSearch = document.getElementById('repo-search');

// Category icons
const categoryIcons = {
  patterns: '🏗️',
  utilities: '🔧',
  integrations: '🔌',
  templates: '📄',
  snippets: '✂️',
  projects: '📁',
  root: '📚',
};

// Initialize
async function init() {
  await loadIndex();
  setupEventListeners();
  handleNavigation();
}

// Load the wiki index
async function loadIndex() {
  try {
    const response = await fetch('/data/index.json');
    if (!response.ok) throw new Error('Failed to load index');
    wikiIndex = await response.json();
    populateFilters();
  } catch (error) {
    console.error('Error loading index:', error);
    // Try loading from API if static file not available
    try {
      const apiResponse = await fetch('/api/index');
      if (apiResponse.ok) {
        wikiIndex = await apiResponse.json();
        populateFilters();
      }
    } catch (apiError) {
      console.error('Error loading from API:', apiError);
    }
  }
}

// Populate filter dropdowns
function populateFilters() {
  if (!wikiIndex) return;

  // Categories
  filterCategory.innerHTML = '<option value="">All Categories</option>';
  wikiIndex.categories.forEach(cat => {
    const option = document.createElement('option');
    option.value = cat;
    option.textContent = cat.charAt(0).toUpperCase() + cat.slice(1);
    filterCategory.appendChild(option);
  });

  // Languages
  const languages = new Set();
  wikiIndex.documents.forEach(doc => {
    if (doc.language) languages.add(doc.language);
  });
  wikiIndex.repos.forEach(repo => {
    repo.languages.forEach(lang => languages.add(lang));
  });

  filterLanguage.innerHTML = '<option value="">All Languages</option>';
  Array.from(languages).sort().forEach(lang => {
    const option = document.createElement('option');
    option.value = lang;
    option.textContent = lang.charAt(0).toUpperCase() + lang.slice(1);
    filterLanguage.appendChild(option);
  });
}

// Setup event listeners
function setupEventListeners() {
  // Navigation
  document.querySelectorAll('[data-page]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const page = e.target.dataset.page;
      navigateTo(page);
    });
  });

  // Search
  searchBtn.addEventListener('click', performSearch);
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') performSearch();
  });

  // Filters
  filterCategory.addEventListener('change', performSearch);
  filterLanguage.addEventListener('change', performSearch);

  // Repo filters
  repoStatusFilter.addEventListener('change', renderRepos);
  repoSearch.addEventListener('input', renderRepos);

  // Browser navigation
  window.addEventListener('popstate', handleNavigation);
}

// Navigate to a page
function navigateTo(page, params = {}) {
  let url = '/' + (page === 'search' ? '' : page);
  if (params.doc) url += '?doc=' + encodeURIComponent(params.doc);
  if (params.category) url += '?category=' + encodeURIComponent(params.category);

  history.pushState({ page, ...params }, '', url);
  showPage(page, params);
}

// Handle browser navigation
function handleNavigation() {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);

  let page = 'search';
  if (path === '/browse' || path.startsWith('/browse')) page = 'browse';
  else if (path === '/repos' || path.startsWith('/repos')) page = 'repos';
  else if (path === '/login') page = 'login';
  else if (path === '/signup') page = 'signup';
  else if (path === '/document' || params.get('doc')) page = 'document';

  const pageParams = {};
  if (params.get('doc')) pageParams.doc = params.get('doc');
  if (params.get('category')) pageParams.category = params.get('category');

  showPage(page, pageParams);
}

// Show a specific page
function showPage(page, params = {}) {
  currentPage = page;

  // Update nav
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.toggle('active', link.dataset.page === page);
  });

  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

  // Show target page
  const pageEl = document.getElementById('page-' + page);
  if (pageEl) {
    pageEl.classList.add('active');
  }

  // Page-specific actions
  switch (page) {
    case 'browse':
      renderCategories();
      if (params.category) {
        selectCategory(params.category);
      }
      break;
    case 'repos':
      renderRepos();
      break;
    case 'document':
      if (params.doc) {
        showDocument(params.doc);
      }
      break;
  }
}

// Perform search
function performSearch() {
  const query = searchInput.value.trim().toLowerCase();
  const category = filterCategory.value;
  const language = filterLanguage.value;

  if (!query && !category && !language) {
    searchResults.innerHTML = '<p class="placeholder-text">Enter a search term to find wiki documents and code</p>';
    return;
  }

  if (!wikiIndex) {
    searchResults.innerHTML = '<p class="placeholder-text">Loading index...</p>';
    return;
  }

  const results = [];

  // Search documents
  wikiIndex.documents.forEach(doc => {
    if (category && doc.category !== category) return;
    if (language && doc.language !== language) return;

    let score = 0;
    const searchText = `${doc.title} ${doc.description || ''} ${doc.tags.join(' ')} ${doc.content}`.toLowerCase();

    if (query) {
      if (doc.title.toLowerCase().includes(query)) score += 50;
      if (doc.tags.some(t => t.toLowerCase().includes(query))) score += 30;
      if (searchText.includes(query)) score += 10;
      if (score === 0) return;
    } else {
      score = 10; // Default score for filter-only results
    }

    results.push({
      type: 'wiki',
      title: doc.title,
      path: doc.relativePath,
      preview: doc.contentPreview,
      score,
      tags: doc.tags,
      language: doc.language,
    });
  });

  // Search repos
  wikiIndex.repos.forEach(repo => {
    if (language && !repo.languages.includes(language)) return;

    let score = 0;
    const searchText = `${repo.name} ${repo.description || ''} ${repo.languages.join(' ')}`.toLowerCase();

    if (query) {
      if (repo.name.toLowerCase().includes(query)) score += 50;
      if (searchText.includes(query)) score += 10;
      if (score === 0) return;
    } else {
      score = 5; // Default score for filter-only results
    }

    results.push({
      type: 'repo',
      title: repo.name,
      path: repo.githubUrl || repo.localPath || '',
      preview: repo.description || 'No description',
      score,
      tags: repo.languages,
      repoName: repo.name,
    });
  });

  // Sort by score
  results.sort((a, b) => b.score - a.score);

  // Render results
  renderSearchResults(results.slice(0, 50));
}

// Render search results
function renderSearchResults(results) {
  if (results.length === 0) {
    searchResults.innerHTML = '<p class="placeholder-text">No results found</p>';
    return;
  }

  searchResults.innerHTML = results.map(result => `
    <div class="result-item" data-type="${result.type}" data-path="${result.path}">
      <div class="result-header">
        <span class="result-title">${escapeHtml(result.title)}</span>
        <span class="result-type">${result.type}</span>
      </div>
      <p class="result-preview">${escapeHtml(result.preview)}</p>
      <div class="result-meta">
        ${result.tags && result.tags.length > 0 ? `
          <div class="result-tags">
            ${result.tags.slice(0, 5).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
          </div>
        ` : ''}
      </div>
    </div>
  `).join('');

  // Add click handlers
  searchResults.querySelectorAll('.result-item').forEach(item => {
    item.addEventListener('click', () => {
      const type = item.dataset.type;
      const path = item.dataset.path;

      if (type === 'wiki') {
        navigateTo('document', { doc: path });
      } else if (type === 'repo' && path.startsWith('http')) {
        window.open(path, '_blank');
      }
    });
  });
}

// Render categories
function renderCategories() {
  if (!wikiIndex) {
    categoriesContainer.innerHTML = '<p class="loading">Loading</p>';
    return;
  }

  const categoryCounts = {};
  wikiIndex.documents.forEach(doc => {
    categoryCounts[doc.category] = (categoryCounts[doc.category] || 0) + 1;
  });

  categoriesContainer.innerHTML = wikiIndex.categories.map(cat => `
    <div class="category-card" data-category="${cat}">
      <div class="category-icon">${categoryIcons[cat] || '📁'}</div>
      <div class="category-name">${cat}</div>
      <div class="category-count">${categoryCounts[cat] || 0} documents</div>
    </div>
  `).join('');

  // Add click handlers
  categoriesContainer.querySelectorAll('.category-card').forEach(card => {
    card.addEventListener('click', () => {
      selectCategory(card.dataset.category);
    });
  });
}

// Select a category
function selectCategory(category) {
  currentCategory = category;

  // Update active state
  categoriesContainer.querySelectorAll('.category-card').forEach(card => {
    card.classList.toggle('active', card.dataset.category === category);
  });

  // Show category documents
  if (!wikiIndex) return;

  const docs = wikiIndex.documents.filter(d => d.category === category);

  if (docs.length === 0) {
    categoryContent.innerHTML = '<p class="placeholder-text">No documents in this category</p>';
    return;
  }

  categoryContent.innerHTML = `
    <h3>${category.charAt(0).toUpperCase() + category.slice(1)}</h3>
    <ul class="doc-list">
      ${docs.map(doc => `
        <li class="doc-list-item" data-path="${doc.relativePath}">
          <div class="doc-list-title">${escapeHtml(doc.title)}</div>
          ${doc.description ? `<div class="doc-list-desc">${escapeHtml(doc.description)}</div>` : ''}
        </li>
      `).join('')}
    </ul>
  `;

  // Add click handlers
  categoryContent.querySelectorAll('.doc-list-item').forEach(item => {
    item.addEventListener('click', () => {
      navigateTo('document', { doc: item.dataset.path });
    });
  });
}

// Render repos
function renderRepos() {
  if (!wikiIndex) {
    reposContainer.innerHTML = '<p class="loading">Loading</p>';
    return;
  }

  const statusFilter = repoStatusFilter.value;
  const searchQuery = repoSearch.value.toLowerCase();

  let repos = wikiIndex.repos;

  if (statusFilter) {
    repos = repos.filter(r => r.status === statusFilter);
  }

  if (searchQuery) {
    repos = repos.filter(r =>
      r.name.toLowerCase().includes(searchQuery) ||
      (r.description && r.description.toLowerCase().includes(searchQuery))
    );
  }

  if (repos.length === 0) {
    reposContainer.innerHTML = '<p class="placeholder-text">No repositories found</p>';
    return;
  }

  reposContainer.innerHTML = repos.map(repo => `
    <div class="repo-card">
      <div class="repo-header">
        <div class="repo-name">
          ${repo.githubUrl ? `<a href="${repo.githubUrl}" target="_blank">${escapeHtml(repo.name)}</a>` : escapeHtml(repo.name)}
        </div>
        <span class="repo-status ${repo.status}">${repo.status.replace('-', ' ')}</span>
      </div>
      ${repo.description ? `<p class="repo-description">${escapeHtml(repo.description)}</p>` : ''}
      ${repo.languages.length > 0 ? `
        <div class="repo-languages">
          ${repo.languages.slice(0, 5).map(lang => `<span class="repo-lang">${escapeHtml(lang)}</span>`).join('')}
        </div>
      ` : ''}
    </div>
  `).join('');
}

// Show document
async function showDocument(docPath) {
  const documentTitle = document.getElementById('document-title');
  const documentMeta = document.getElementById('document-meta');
  const documentContent = document.getElementById('document-content');
  const backLink = document.getElementById('back-link');

  documentContent.innerHTML = '<p class="loading">Loading</p>';

  // Set back link
  backLink.onclick = (e) => {
    e.preventDefault();
    history.back();
  };

  // Find document in index
  if (!wikiIndex) {
    documentContent.innerHTML = '<p>Error: Index not loaded</p>';
    return;
  }

  const doc = wikiIndex.documents.find(d => d.relativePath === docPath);

  if (!doc) {
    documentTitle.textContent = 'Document Not Found';
    documentMeta.innerHTML = '';
    documentContent.innerHTML = '<p>The requested document could not be found.</p>';
    return;
  }

  currentDocument = doc;
  documentTitle.textContent = doc.title;

  // Meta info
  const metaParts = [];
  if (doc.category) metaParts.push(`Category: ${doc.category}`);
  if (doc.language) metaParts.push(`Language: ${doc.language}`);
  if (doc.updated) metaParts.push(`Updated: ${doc.updated}`);
  documentMeta.innerHTML = metaParts.join(' | ');

  // Render content (basic markdown to HTML)
  documentContent.innerHTML = renderMarkdown(doc.content);
}

// Basic markdown renderer
function renderMarkdown(text) {
  // This is a simple renderer - for production, use a library like marked.js
  let html = escapeHtml(text);

  // Headers
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

  // Lists
  html = html.replace(/^\- (.+)$/gim, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

  // Paragraphs
  html = html.replace(/\n\n/g, '</p><p>');
  html = '<p>' + html + '</p>';

  // Clean up
  html = html.replace(/<p><\/p>/g, '');
  html = html.replace(/<p>(<h[1-3]>)/g, '$1');
  html = html.replace(/(<\/h[1-3]>)<\/p>/g, '$1');
  html = html.replace(/<p>(<pre>)/g, '$1');
  html = html.replace(/(<\/pre>)<\/p>/g, '$1');
  html = html.replace(/<p>(<ul>)/g, '$1');
  html = html.replace(/(<\/ul>)<\/p>/g, '$1');

  return html;
}

// Escape HTML
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize on load
document.addEventListener('DOMContentLoaded', init);
