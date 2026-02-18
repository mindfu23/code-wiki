/**
 * Code Wiki - Frontend Application
 */

// State
let wikiIndex = null;
let currentPage = 'search';
let currentCategory = null;
let currentDocument = null;
let currentUser = null;
let editingDocument = null;
let isDirty = false;

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
  await checkAuth();  // Check auth first so we know if user can see private repos
  await loadIndex();  // Load index based on auth state
  setupEventListeners();
  setupEditor();
  handleNavigation();
}

// Load the wiki index
// If user is authenticated, try to load full index (includes private repos)
// Otherwise, load public index
async function loadIndex() {
  try {
    // If user is logged in, try to get full index with private repos
    if (currentUser) {
      try {
        const fullResponse = await fetch('/.netlify/functions/full-index', {
          credentials: 'include'
        });
        if (fullResponse.ok) {
          const result = await fullResponse.json();
          if (result.success && result.data) {
            wikiIndex = result.data;
            console.log(`Loaded full index (${result.accessMode}, isOwner: ${result.isOwner})`);
            populateFilters();
            return;
          }
        }
      } catch (fullError) {
        console.log('Full index not available, falling back to public index');
      }
    }

    // Fall back to public index
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

  // Include repo files toggle
  const includeRepoFilesToggle = document.getElementById('include-repo-files');
  if (includeRepoFilesToggle) {
    includeRepoFilesToggle.addEventListener('change', performSearch);
  }

  // Quick View refresh button
  const refreshQuickViewBtn = document.getElementById('refresh-quickview-btn');
  if (refreshQuickViewBtn) {
    refreshQuickViewBtn.addEventListener('click', refreshQuickView);
  }

  // Repo filters
  repoStatusFilter.addEventListener('change', renderRepos);
  repoSearch.addEventListener('input', renderRepos);

  // Repo view tabs
  document.querySelectorAll('.repo-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      switchRepoTab(tabName);
    });
  });

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
  else if (path === '/editor' || path.startsWith('/editor')) page = 'editor';
  else if (path === '/document' || params.get('doc')) page = 'document';

  const pageParams = {};
  if (params.get('doc')) pageParams.doc = params.get('doc');
  if (params.get('category')) pageParams.category = params.get('category');
  if (params.get('tab')) pageParams.tab = params.get('tab');

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
    case 'search':
      loadQuickView();
      renderRecentDocs();
      break;
    case 'browse':
      renderCategories();
      renderRepos();
      loadRepoFilesView();
      loadRepoListView();
      if (params.tab) {
        switchRepoTab(params.tab);
      }
      if (params.category) {
        selectCategory(params.category);
      }
      break;
    case 'repos':
      // Redirect /repos to /browse
      navigateTo('browse');
      return;
    case 'document':
      if (params.doc) {
        showDocument(params.doc);
      }
      break;
    case 'editor':
      if (params.doc) {
        openEditor(params.doc);
      }
      break;
  }
}

// Perform search
function performSearch() {
  const query = searchInput.value.trim().toLowerCase();
  const category = filterCategory.value;
  const language = filterLanguage.value;
  const includeRepoFiles = document.getElementById('include-repo-files')?.checked ?? true;

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
      path: repo.githubUrl || '',
      preview: repo.description || 'No description',
      score,
      tags: repo.languages,
      repoName: repo.name,
    });
  });

  // Search repo files (if toggle is on)
  if (includeRepoFiles && query) {
    wikiIndex.repos.forEach(repo => {
      if (!repo.markdownFiles || !repo.githubUrl) return;
      if (language && !repo.languages.includes(language)) return;

      const githubBaseUrl = repo.githubUrl.replace(/\.git$/, '');

      repo.markdownFiles.forEach(file => {
        let score = 0;
        const searchText = `${file.relativePath} ${file.name}`.toLowerCase();

        if (file.name.toLowerCase().includes(query)) score += 40;
        else if (searchText.includes(query)) score += 15;

        if (score > 0) {
          const fileType = file.fileType || 'md';
          const icon = getFileTypeIcon(fileType);
          results.push({
            type: 'repo-file',
            title: `${icon} ${file.relativePath}`,
            path: `${githubBaseUrl}/edit/main/${file.relativePath}`,
            preview: `${repo.name} - ${file.name}`,
            score,
            tags: repo.languages,
            repoName: repo.name,
            fileType,
          });
        }
      });
    });
  }

  // Sort by score
  results.sort((a, b) => b.score - a.score);

  // Render results
  renderSearchResults(results.slice(0, 50));
}

// Get display label for result type
function getResultTypeLabel(type) {
  switch (type) {
    case 'wiki': return 'wiki';
    case 'repo': return 'repo';
    case 'repo-file': return 'file';
    default: return type;
  }
}

// Render search results
function renderSearchResults(results) {
  if (results.length === 0) {
    searchResults.innerHTML = '<p class="placeholder-text">No results found</p>';
    return;
  }

  searchResults.innerHTML = results.map(result => `
    <div class="result-item" data-type="${result.type}" data-path="${escapeHtml(result.path)}">
      <div class="result-header">
        <span class="result-title">${escapeHtml(result.title)}</span>
        <span class="result-type ${result.type}">${getResultTypeLabel(result.type)}</span>
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
      } else if ((type === 'repo' || type === 'repo-file') && path.startsWith('http')) {
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

// Switch between repo view tabs
function switchRepoTab(tabName) {
  // Update tab buttons
  document.querySelectorAll('.repo-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });

  // Update view visibility
  document.querySelectorAll('.repo-view').forEach(view => {
    view.classList.remove('active');
  });

  const activeView = document.getElementById(`repo-${tabName}-view`);
  if (activeView) {
    activeView.classList.add('active');
  }

  // Render docs view on demand
  if (tabName === 'docs') {
    renderDocsView();
  }
}

// Load repository list view content from repo-locations.md
function loadRepoListView() {
  const container = document.getElementById('repo-list-content');
  if (!container) return;

  // Find the repo-locations document in the index
  const doc = wikiIndex?.documents.find(d => d.relativePath === 'projects/repo-locations.md');

  if (doc) {
    container.innerHTML = renderMarkdown(doc.content);
  } else {
    container.innerHTML = '<p class="placeholder-text">Repository index not found</p>';
  }
}

// Get icon for file type
function getFileTypeIcon(fileType) {
  const icons = {
    md: '📝',
    txt: '📄',
    rst: '📜',
    adoc: '📋',
    org: '📓'
  };
  return icons[fileType] || '📄';
}

// Load repository files view - shows repos alphabetically with their doc files
function loadRepoFilesView() {
  const container = document.getElementById('repo-files-content');
  if (!container) return;

  if (!wikiIndex || !wikiIndex.repos) {
    container.innerHTML = '<p class="placeholder-text">Loading repository data...</p>';
    return;
  }

  // Sort repos alphabetically
  const repos = [...wikiIndex.repos].sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  );

  // Filter to repos that have documentation files
  const reposWithDocFiles = repos.filter(repo =>
    repo.markdownFiles && repo.markdownFiles.length > 0
  );

  if (reposWithDocFiles.length === 0) {
    container.innerHTML = '<p class="placeholder-text">No documentation files found in repositories. Rebuild the index to scan for files.</p>';
    return;
  }

  // Build the HTML
  let html = '<div class="repo-files-list">';

  for (const repo of reposWithDocFiles) {
    const githubBaseUrl = repo.githubUrl ? repo.githubUrl.replace(/\.git$/, '') : null;

    html += `<div class="repo-files-item">`;
    html += `<div class="repo-files-header">`;
    if (githubBaseUrl) {
      html += `<a href="${githubBaseUrl}" target="_blank" class="repo-files-name">${escapeHtml(repo.name)}</a>`;
    } else {
      html += `<span class="repo-files-name">${escapeHtml(repo.name)}</span>`;
    }
    html += `<span class="repo-files-count">${repo.markdownFiles.length} file${repo.markdownFiles.length !== 1 ? 's' : ''}</span>`;
    html += `</div>`;

    html += `<ul class="repo-doc-files">`;
    for (const file of repo.markdownFiles) {
      const fileType = file.fileType || 'md';
      const icon = getFileTypeIcon(fileType);
      if (githubBaseUrl) {
        const fileUrl = `${githubBaseUrl}/blob/main/${file.relativePath}`;
        html += `<li data-type="${fileType}"><span class="file-icon">${icon}</span><a href="${fileUrl}" target="_blank">${escapeHtml(file.relativePath)}</a></li>`;
      } else {
        html += `<li data-type="${fileType}"><span class="file-icon">${icon}</span>${escapeHtml(file.relativePath)}</li>`;
      }
    }
    html += `</ul>`;
    html += `</div>`;
  }

  html += '</div>';
  container.innerHTML = html;
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

  // Show edit button if logged in AND document is editable (not auto-generated)
  const editBtn = document.getElementById('edit-btn');
  if (editBtn) {
    const isAutoGenerated = doc.tags && doc.tags.includes('auto-generated');
    editBtn.style.display = currentUser && !isAutoGenerated ? 'inline-block' : 'none';
    editBtn.onclick = () => openEditor(docPath);
  }
}

// Basic markdown renderer
function renderMarkdown(text) {
  // This is a simple renderer - for production, use a library like marked.js

  // First, process tables before escaping HTML
  const lines = text.split('\n');
  const processedLines = [];
  let inTable = false;
  let tableLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Check if this is a table row (starts and ends with |, or is a separator row)
    const isTableRow = line.startsWith('|') && line.endsWith('|');
    const isSeparator = /^\|[\s\-:|]+\|$/.test(line);

    if (isTableRow || isSeparator) {
      if (!inTable) {
        inTable = true;
        tableLines = [];
      }
      tableLines.push(line);
    } else {
      if (inTable) {
        // End of table, process it
        processedLines.push(renderTable(tableLines));
        inTable = false;
        tableLines = [];
      }
      processedLines.push(lines[i]);
    }
  }

  // Handle table at end of content
  if (inTable && tableLines.length > 0) {
    processedLines.push(renderTable(tableLines));
  }

  let html = escapeHtml(processedLines.join('\n'));

  // Restore tables (they were marked with special tokens)
  html = html.replace(/\[TABLE_START\]/g, '<table>');
  html = html.replace(/\[TABLE_END\]/g, '</table>');
  html = html.replace(/\[THEAD_START\]/g, '<thead>');
  html = html.replace(/\[THEAD_END\]/g, '</thead>');
  html = html.replace(/\[TBODY_START\]/g, '<tbody>');
  html = html.replace(/\[TBODY_END\]/g, '</tbody>');
  html = html.replace(/\[TR_START\]/g, '<tr>');
  html = html.replace(/\[TR_END\]/g, '</tr>');
  html = html.replace(/\[TH_START\]/g, '<th>');
  html = html.replace(/\[TH_END\]/g, '</th>');
  html = html.replace(/\[TD_START\]/g, '<td>');
  html = html.replace(/\[TD_END\]/g, '</td>');

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

  // Horizontal rules
  html = html.replace(/^---$/gim, '<hr>');

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
  html = html.replace(/<p>(<table>)/g, '$1');
  html = html.replace(/(<\/table>)<\/p>/g, '$1');
  html = html.replace(/<p>(<hr>)/g, '$1');
  html = html.replace(/(<hr>)<\/p>/g, '$1');

  return html;
}

// Render markdown table to HTML (with token placeholders to survive escaping)
function renderTable(lines) {
  if (lines.length < 2) return lines.join('\n');

  let result = '[TABLE_START]';
  let isHeader = true;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip separator rows (|---|---|)
    if (/^\|[\s\-:|]+\|$/.test(line)) {
      if (isHeader) {
        result += '[THEAD_END][TBODY_START]';
        isHeader = false;
      }
      continue;
    }

    // Parse cells
    const cells = line.split('|').slice(1, -1).map(c => c.trim());

    if (isHeader && i === 0) {
      result += '[THEAD_START]';
    }

    result += '[TR_START]';
    cells.forEach(cell => {
      if (isHeader && i === 0) {
        result += `[TH_START]${cell}[TH_END]`;
      } else {
        result += `[TD_START]${cell}[TD_END]`;
      }
    });
    result += '[TR_END]';
  }

  if (isHeader) {
    result += '[THEAD_END]';
  } else {
    result += '[TBODY_END]';
  }

  result += '[TABLE_END]';
  return result;
}

// Escape HTML for safe use in both content and attributes
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================
// AUTH MODULE
// ============================================

// Check authentication status
async function checkAuth() {
  console.log('checkAuth: starting...');
  try {
    const response = await fetch('/.netlify/functions/user', {
      credentials: 'include',
    });
    console.log('checkAuth: response status', response.status);
    if (response.ok) {
      const data = await response.json();
      console.log('checkAuth: user data', data);
      currentUser = data.user;
    } else {
      const errorText = await response.text();
      console.log('checkAuth: not authenticated', errorText);
      currentUser = null;
    }
  } catch (err) {
    console.error('checkAuth: failed', err);
    currentUser = null;
  }
  console.log('checkAuth: currentUser =', currentUser);
  updateAuthUI();
}

// Update UI based on auth state
function updateAuthUI() {
  console.log('updateAuthUI: currentUser =', currentUser);
  const loginNavLink = document.getElementById('login-nav-link');
  const userNav = document.getElementById('user-nav');
  const userAvatar = document.getElementById('user-avatar');
  const userName = document.getElementById('user-name');
  const logoutBtn = document.getElementById('logout-btn');
  const editBtn = document.getElementById('edit-btn');

  console.log('updateAuthUI: elements found', { loginNavLink: !!loginNavLink, userNav: !!userNav });

  if (currentUser) {
    console.log('updateAuthUI: showing user nav for', currentUser.login);
    // Show user nav, hide login link
    if (loginNavLink) loginNavLink.style.display = 'none';
    if (userNav) {
      userNav.style.display = 'flex';
      if (userAvatar) userAvatar.src = currentUser.avatar_url || '';
      if (userName) userName.textContent = currentUser.name || currentUser.login;
    }
    if (logoutBtn) {
      logoutBtn.onclick = handleLogout;
    }
    // Show edit button on document page (unless auto-generated)
    if (editBtn && currentDocument) {
      const isAutoGenerated = currentDocument.tags && currentDocument.tags.includes('auto-generated');
      editBtn.style.display = isAutoGenerated ? 'none' : 'inline-block';
    }
  } else {
    // Show login link, hide user nav
    if (loginNavLink) loginNavLink.style.display = 'inline';
    if (userNav) userNav.style.display = 'none';
    if (editBtn) editBtn.style.display = 'none';
  }
}

// Handle login - redirect to GitHub OAuth
function handleLogin() {
  window.location.href = '/.netlify/functions/oauth-login';
}

// Handle logout
async function handleLogout() {
  try {
    await fetch('/.netlify/functions/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ action: 'logout' }),
    });
  } catch (err) {
    console.error('Logout error:', err);
  }

  currentUser = null;
  quickViewCache = null;  // Clear cache since visible repos may change
  quickViewLoaded = false;
  await loadIndex();  // Reload index to get public-only data
  updateAuthUI();
  navigateTo('search');
}

// ============================================
// EDITOR MODULE
// ============================================

// Setup editor event listeners
function setupEditor() {
  // GitHub login button on login page
  const githubLoginBtn = document.getElementById('github-login-btn');
  if (githubLoginBtn) {
    githubLoginBtn.addEventListener('click', handleLogin);
  }

  // New document button and modal
  const newDocBtn = document.getElementById('new-doc-btn');
  const newDocModal = document.getElementById('new-doc-modal');
  const newDocCancel = document.getElementById('new-doc-cancel');
  const newDocCreate = document.getElementById('new-doc-create');
  const modalBackdrop = newDocModal?.querySelector('.modal-backdrop');

  if (newDocBtn) {
    newDocBtn.addEventListener('click', () => {
      if (newDocModal) {
        newDocModal.style.display = 'flex';
        document.getElementById('new-doc-filename').value = '';
        document.getElementById('new-doc-filename').focus();
      }
    });
  }

  if (newDocCancel) {
    newDocCancel.addEventListener('click', closeNewDocModal);
  }

  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', closeNewDocModal);
  }

  if (newDocCreate) {
    newDocCreate.addEventListener('click', createNewDocument);
  }

  // Enter key in filename field
  const filenameInput = document.getElementById('new-doc-filename');
  if (filenameInput) {
    filenameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') createNewDocument();
    });
  }

  // Preview toggle
  const previewToggle = document.getElementById('editor-preview-toggle');
  const editorMain = document.querySelector('.editor-main');
  const previewPane = document.getElementById('preview-pane');

  if (previewToggle) {
    previewToggle.addEventListener('click', () => {
      if (editorMain) editorMain.classList.toggle('split-view');
      if (previewPane) {
        previewPane.classList.toggle('hidden');
        previewToggle.textContent = previewPane.classList.contains('hidden')
          ? 'Preview'
          : 'Hide Preview';
        if (!previewPane.classList.contains('hidden')) {
          updatePreview();
        }
      }
    });
  }

  // Content change -> update preview
  const contentArea = document.getElementById('editor-content');
  if (contentArea) {
    contentArea.addEventListener('input', () => {
      isDirty = true;
      const previewPane = document.getElementById('preview-pane');
      if (previewPane && !previewPane.classList.contains('hidden')) {
        updatePreview();
      }
    });

    // Keyboard shortcuts
    contentArea.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveDocument();
      }
    });
  }

  // Save button
  const saveBtn = document.getElementById('editor-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', saveDocument);
  }

  // Toolbar actions
  document.querySelectorAll('.editor-toolbar button').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action) applyToolbarAction(action);
    });
  });

  // Back link
  const backLink = document.getElementById('editor-back-link');
  if (backLink) {
    backLink.addEventListener('click', (e) => {
      e.preventDefault();
      if (isDirty && !confirm('You have unsaved changes. Discard?')) {
        return;
      }
      isDirty = false;
      history.back();
    });
  }

  // Warn before leaving with unsaved changes
  window.addEventListener('beforeunload', (e) => {
    if (isDirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

// Close new document modal
function closeNewDocModal() {
  const modal = document.getElementById('new-doc-modal');
  if (modal) modal.style.display = 'none';
}

// Create new document from modal
function createNewDocument() {
  const category = document.getElementById('new-doc-category').value;
  const filename = document.getElementById('new-doc-filename').value.trim();

  if (!filename) {
    alert('Please enter a filename');
    return;
  }

  // Sanitize filename (alphanumeric, hyphens, underscores only)
  const sanitized = filename
    .toLowerCase()
    .replace(/[^a-z0-9\-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!sanitized) {
    alert('Invalid filename');
    return;
  }

  closeNewDocModal();

  // Open editor for new document
  openEditorForNew(category, sanitized);
}

// Open editor for a new document
function openEditorForNew(category, filename) {
  if (!currentUser) {
    navigateTo('login');
    return;
  }

  const relativePath = `${category}/${filename}.md`;

  // Create a temporary document object for new doc
  editingDocument = {
    relativePath,
    category,
    title: '',
    description: '',
    tags: [],
    language: '',
    content: '',
    isNew: true,
  };
  isDirty = false;

  // Clear editor fields
  document.getElementById('edit-title').value = '';
  document.getElementById('edit-description').value = '';
  document.getElementById('edit-tags').value = '';
  document.getElementById('edit-language').value = '';
  document.getElementById('editor-content').value = '';
  document.getElementById('commit-message').value = `Add ${filename}`;

  // Update title
  document.getElementById('editor-title').textContent = `New Document: ${category}/${filename}.md`;

  // Clear status
  const status = document.getElementById('editor-status');
  if (status) {
    status.className = 'editor-status';
    status.textContent = '';
  }

  // Reset preview
  const previewPane = document.getElementById('preview-pane');
  if (previewPane) previewPane.classList.add('hidden');
  const previewToggle = document.getElementById('editor-preview-toggle');
  if (previewToggle) previewToggle.textContent = 'Preview';

  // Navigate to editor
  navigateTo('editor', { doc: relativePath });
}

// Open editor for a document
function openEditor(docPath) {
  if (!currentUser) {
    navigateTo('login');
    return;
  }

  // Find document in index
  let doc = wikiIndex?.documents.find(d => d.relativePath === docPath);

  if (!doc) {
    // Check if this might be a new document being created
    if (editingDocument?.relativePath === docPath && editingDocument?.isNew) {
      // Already set up for new document, just show editor
      return;
    }

    // Try to restore from sessionStorage (for documents not yet in index)
    try {
      const savedDoc = sessionStorage.getItem('editingDocument');
      if (savedDoc) {
        const parsed = JSON.parse(savedDoc);
        if (parsed.relativePath === docPath) {
          doc = parsed;
          console.log('Restored document from sessionStorage');
        }
      }
    } catch (e) {
      console.error('Failed to restore document from sessionStorage:', e);
    }

    if (!doc) {
      alert('Document not found in index. It may not have synced yet. Please try again in a moment.');
      navigateTo('browse');
      return;
    }
  }

  editingDocument = doc;
  isDirty = false;

  // Save to sessionStorage for page refreshes
  try {
    sessionStorage.setItem('editingDocument', JSON.stringify(doc));
  } catch (e) {
    console.error('Failed to save document to sessionStorage:', e);
  }

  // Populate editor fields
  document.getElementById('edit-title').value = doc.title || '';
  document.getElementById('edit-description').value = doc.description || '';
  document.getElementById('edit-tags').value = (doc.tags || []).join(', ');
  document.getElementById('edit-language').value = doc.language || '';
  document.getElementById('editor-content').value = extractContentBody(doc.content);
  document.getElementById('commit-message').value = `Update ${doc.title}`;

  // Update title
  document.getElementById('editor-title').textContent = `Edit: ${doc.title}`;

  // Clear status
  const status = document.getElementById('editor-status');
  if (status) {
    status.className = 'editor-status';
    status.textContent = '';
  }

  // Reset preview
  const previewPane = document.getElementById('preview-pane');
  if (previewPane) previewPane.classList.add('hidden');
  const previewToggle = document.getElementById('editor-preview-toggle');
  if (previewToggle) previewToggle.textContent = 'Preview';

  // Navigate to editor
  navigateTo('editor', { doc: docPath });
}

// Extract content body (without frontmatter)
function extractContentBody(content) {
  if (!content) return '';
  // If content starts with ---, extract body after second ---
  if (content.startsWith('---')) {
    const endIndex = content.indexOf('---', 3);
    if (endIndex !== -1) {
      return content.slice(endIndex + 3).trim();
    }
  }
  return content;
}

// Build frontmatter from form fields
function buildFrontmatter() {
  const title = document.getElementById('edit-title').value.trim();
  const description = document.getElementById('edit-description').value.trim();
  const tags = document.getElementById('edit-tags').value
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);
  const language = document.getElementById('edit-language').value;

  // Build YAML frontmatter
  let yaml = '---\n';
  yaml += `title: "${title}"\n`;
  if (description) yaml += `description: "${description}"\n`;
  if (tags.length > 0) yaml += `tags: [${tags.map(t => `"${t}"`).join(', ')}]\n`;
  if (language) yaml += `language: "${language}"\n`;
  yaml += `updated: "${new Date().toISOString().split('T')[0]}"\n`;
  yaml += '---\n\n';

  return yaml;
}

// Build full document content
function buildDocumentContent() {
  const frontmatter = buildFrontmatter();
  const body = document.getElementById('editor-content').value;
  return frontmatter + body;
}

// Update preview
function updatePreview() {
  const content = document.getElementById('editor-content').value;
  const preview = document.getElementById('editor-preview');
  if (preview) {
    preview.innerHTML = renderMarkdown(content);
  }
}

// Save document
async function saveDocument() {
  if (!currentUser) {
    alert('Session expired. Please log in again.');
    navigateTo('login');
    return;
  }
  if (!editingDocument) {
    alert('No document to save. Please try opening the document again.');
    return;
  }

  const saveBtn = document.getElementById('editor-save');
  const status = document.getElementById('editor-status');

  // Validate
  const title = document.getElementById('edit-title').value.trim();
  if (!title) {
    showEditorStatus('error', 'Title is required');
    return;
  }

  const commitMessage = document.getElementById('commit-message').value.trim();
  if (!commitMessage) {
    showEditorStatus('error', 'Commit message is required');
    return;
  }

  // Build content
  const content = buildDocumentContent();

  // Disable save button
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }
  showEditorStatus('loading', 'Committing changes to GitHub...');

  try {
    const response = await fetch('/.netlify/functions/save-document', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        path: editingDocument.relativePath,
        content,
        commitMessage,
        isNew: editingDocument.isNew || false,
      }),
    });

    const result = await response.json();

    if (response.ok && result.success) {
      isDirty = false;
      const isNew = editingDocument.isNew;
      showEditorStatus('success', `${isNew ? 'Created' : 'Saved'}! Commit: ${result.commit.sha.slice(0, 7)}`);

      // Update local index - store body only (without frontmatter)
      editingDocument.content = extractContentBody(content);
      editingDocument.title = title;
      editingDocument.description = document.getElementById('edit-description').value.trim();
      editingDocument.updated = new Date().toISOString().split('T')[0];

      // Add to index if new
      if (isNew && wikiIndex) {
        editingDocument.isNew = false;
        const bodyContent = extractContentBody(content);
        editingDocument.contentPreview = bodyContent.slice(0, 200).replace(/\n/g, ' ').trim();
        wikiIndex.documents.push(editingDocument);
      }

      // Update sessionStorage with the saved document
      try {
        sessionStorage.setItem('editingDocument', JSON.stringify(editingDocument));
      } catch (e) {
        console.error('Failed to update sessionStorage:', e);
      }

      // Redirect back to document view after short delay
      setTimeout(() => {
        // Clear sessionStorage when leaving editor
        sessionStorage.removeItem('editingDocument');
        navigateTo('document', { doc: editingDocument.relativePath });
      }, 1500);
    } else {
      showEditorStatus('error', result.error || 'Failed to save');
    }
  } catch (err) {
    console.error('Save error:', err);
    showEditorStatus('error', 'Network error. Please try again.');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save & Commit';
    }
  }
}

// Show editor status message
function showEditorStatus(type, message) {
  const status = document.getElementById('editor-status');
  if (status) {
    status.className = `editor-status ${type}`;
    status.textContent = message;
  }
}

// Toolbar actions for markdown formatting
function applyToolbarAction(action) {
  const textarea = document.getElementById('editor-content');
  if (!textarea) return;

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.substring(start, end);

  let replacement = '';
  let cursorOffset = 0;

  switch (action) {
    case 'bold':
      replacement = `**${selected || 'bold text'}**`;
      cursorOffset = selected ? 0 : -2;
      break;
    case 'italic':
      replacement = `*${selected || 'italic text'}*`;
      cursorOffset = selected ? 0 : -1;
      break;
    case 'code':
      replacement = `\`${selected || 'code'}\``;
      cursorOffset = selected ? 0 : -1;
      break;
    case 'link':
      replacement = `[${selected || 'link text'}](url)`;
      cursorOffset = -1;
      break;
    case 'heading':
      replacement = `## ${selected || 'Heading'}`;
      break;
    case 'list':
      replacement = `- ${selected || 'List item'}`;
      break;
    case 'codeblock':
      replacement = `\`\`\`\n${selected || 'code here'}\n\`\`\``;
      cursorOffset = selected ? 0 : -4;
      break;
    default:
      return;
  }

  textarea.value =
    textarea.value.substring(0, start) +
    replacement +
    textarea.value.substring(end);

  textarea.focus();
  const newPos = start + replacement.length + cursorOffset;
  textarea.setSelectionRange(newPos, newPos);

  isDirty = true;
  updatePreview();
}

// Quick View - Deployment table with Netlify integration
let netlifySites = null;
let quickViewCache = null;  // Cache for Quick View HTML
let quickViewLoaded = false;  // Flag to track if Quick View has been loaded

async function loadQuickView(forceRefresh = false) {
  // Quick View table on search page only
  const searchBody = document.getElementById('search-quickview-tbody');

  if (!wikiIndex) return;
  if (!searchBody) return;

  // Skip if already loaded and not forcing refresh
  if (quickViewLoaded && !forceRefresh) {
    return;
  }

  // Show loading state
  const loadingHtml = '<tr><td colspan="4" class="loading">Loading deployment data...</td></tr>';
  searchBody.innerHTML = loadingHtml;

  // Clear Netlify sites cache on force refresh
  if (forceRefresh) {
    netlifySites = null;
  }

  // Fetch Netlify sites if not already loaded
  if (!netlifySites) {
    try {
      const response = await fetch('/.netlify/functions/netlify-sites');
      const data = await response.json();
      if (data.success && data.data?.sites) {
        netlifySites = data.data.sites;
      } else {
        netlifySites = [];
        console.warn('Could not load Netlify sites:', data.error || 'Unknown error');
      }
    } catch (error) {
      console.error('Error fetching Netlify sites:', error);
      netlifySites = [];
    }
  }

  // Build a map of GitHub URLs to Netlify sites
  const netlifyByRepoUrl = new Map();
  netlifySites.forEach(site => {
    if (site.repoUrl) {
      // Normalize the repo URL (remove .git suffix, etc.)
      const normalizedUrl = site.repoUrl.replace(/\.git$/, '').toLowerCase();
      netlifyByRepoUrl.set(normalizedUrl, site);
    }
  });

  // Build repo data with Netlify info
  const repoData = wikiIndex.repos.map(repo => {
    const githubUrl = repo.githubUrl?.replace(/\.git$/, '') || '';
    const normalizedGithub = githubUrl.toLowerCase();
    const netlifySite = netlifyByRepoUrl.get(normalizedGithub);
    return { repo, githubUrl, netlifySite };
  });

  // Sort: deployed repos first (alphabetically), then non-deployed (alphabetically)
  repoData.sort((a, b) => {
    const aDeployed = !!a.netlifySite;
    const bDeployed = !!b.netlifySite;
    if (aDeployed !== bDeployed) {
      return bDeployed - aDeployed; // Deployed first
    }
    return a.repo.name.localeCompare(b.repo.name); // Alphabetical within group
  });

  // Find the index where non-deployed repos start
  const firstNonDeployedIndex = repoData.findIndex(({ netlifySite }) => !netlifySite);
  const hasDeployed = firstNonDeployedIndex !== 0;
  const hasNonDeployed = firstNonDeployedIndex !== -1;

  // Render the table with separator row
  const rows = [];
  repoData.forEach(({ repo, githubUrl, netlifySite }, index) => {
    // Add separator row before first non-deployed repo (if there are deployed repos before it)
    if (hasDeployed && hasNonDeployed && index === firstNonDeployedIndex) {
      rows.push(`
        <tr class="separator-row">
          <td colspan="4">Unstaged</td>
        </tr>
      `);
    }

    // GitHub link
    const githubLink = githubUrl
      ? `<a href="${escapeHtml(githubUrl)}" target="_blank" title="View on GitHub">${escapeHtml(repo.name)}</a>`
      : escapeHtml(repo.name);

    // Staging link - show URL without https://
    let stagingCell = '<span class="no-deploy">-</span>';
    if (netlifySite) {
      const displayUrl = netlifySite.url.replace(/^https?:\/\//, '');
      stagingCell = `<a href="${escapeHtml(netlifySite.url)}" target="_blank" class="netlify-link" title="View live site">${escapeHtml(displayUrl)}</a>`;
    }

    // Docs link - find README.md or first markdown file
    const docsContent = renderDocsCell(repo, githubUrl);

    // Notes - with edit button if logged in
    const notesContent = renderNotesCell(repo.name, repo.notes || '');

    rows.push(`
      <tr>
        <td>${githubLink}</td>
        <td>${stagingCell}</td>
        <td class="docs-cell">${docsContent}</td>
        <td class="notes-cell">${notesContent}</td>
      </tr>
    `);
  });

  const rowsHtml = rows.join('');

  const finalHtml = rowsHtml || '<tr><td colspan="4" class="placeholder-text">No repositories found</td></tr>';

  // Cache the generated HTML and mark as loaded
  quickViewCache = finalHtml;
  quickViewLoaded = true;
  searchBody.innerHTML = finalHtml;
}

// Refresh Quick View (clear cache and reload)
async function refreshQuickView() {
  const btn = document.getElementById('refresh-quickview-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Refreshing...';
  }

  // Also reload the index to get latest data
  await loadIndex();
  await loadQuickView(true);

  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Refresh';
  }
}

// ============================================
// DOCS COLUMN MODULE
// ============================================

// Render docs cell - link to README.md, first markdown file, or "Docs needed"
function renderDocsCell(repo, githubUrl) {
  const markdownFiles = repo.markdownFiles || [];

  if (markdownFiles.length === 0) {
    // No docs - show "Docs needed" with link to create
    if (currentUser && githubUrl) {
      return `<span class="docs-needed" onclick="openRepoDocEditor('${escapeHtml(repo.name)}', '${escapeHtml(githubUrl)}')">Docs needed</span>`;
    } else {
      return '<span class="no-deploy">-</span>';
    }
  }

  // Find README.md (case insensitive) or use first file
  const readmeFile = markdownFiles.find(f =>
    f.name.toLowerCase() === 'readme.md'
  );
  const docFile = readmeFile || markdownFiles[0];

  if (!docFile) {
    return '<span class="no-deploy">-</span>';
  }

  // Link to GitHub blob view
  if (githubUrl) {
    const blobUrl = `${githubUrl.replace(/\.git$/, '')}/blob/main/${docFile.relativePath}`;
    const displayName = docFile.name.length > 20
      ? docFile.name.substring(0, 17) + '...'
      : docFile.name;
    return `<a href="${escapeHtml(blobUrl)}" target="_blank" title="${escapeHtml(docFile.relativePath)}">${escapeHtml(displayName)}</a>`;
  }

  return escapeHtml(docFile.name);
}

// Open editor to create a new doc for a repo
function openRepoDocEditor(repoName, githubUrl) {
  if (!currentUser) {
    navigateTo('login');
    return;
  }

  // Store repo info for the editor
  window.pendingRepoDoc = {
    repoName,
    githubUrl,
    defaultFilename: 'README.md'
  };

  // Show the repo doc modal
  const modal = document.getElementById('repo-doc-modal');
  if (modal) {
    modal.style.display = 'flex';
    document.getElementById('repo-doc-repo-name').textContent = repoName;
    document.getElementById('repo-doc-filename').value = 'README.md';
    document.getElementById('repo-doc-content').value = `# ${repoName}\n\n`;
    document.getElementById('repo-doc-content').focus();
  }
}

// Close repo doc modal
function closeRepoDocModal() {
  const modal = document.getElementById('repo-doc-modal');
  if (modal) {
    modal.style.display = 'none';
  }
  window.pendingRepoDoc = null;
}

// Save repo doc
async function saveRepoDoc() {
  if (!currentUser || !window.pendingRepoDoc) {
    alert('Please log in to create documentation');
    return;
  }

  const { repoName, githubUrl } = window.pendingRepoDoc;
  const filename = document.getElementById('repo-doc-filename').value.trim();
  const content = document.getElementById('repo-doc-content').value;

  if (!filename) {
    alert('Please enter a filename');
    return;
  }

  // Validate filename extension
  const validExtensions = ['.md', '.txt', '.rst', '.adoc', '.asciidoc', '.org'];
  const hasValidExt = validExtensions.some(ext => filename.toLowerCase().endsWith(ext));
  if (!hasValidExt) {
    alert('Please use a supported file extension: ' + validExtensions.join(', '));
    return;
  }

  const saveBtn = document.getElementById('repo-doc-save');
  const status = document.getElementById('repo-doc-status');

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }
  if (status) {
    status.className = 'editor-status loading';
    status.textContent = 'Committing to repository...';
  }

  try {
    const response = await fetch('/.netlify/functions/save-repo-doc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        repoName,
        githubUrl,
        filename,
        content,
      }),
    });

    const result = await response.json();

    if (response.ok && result.success) {
      if (status) {
        status.className = 'editor-status success';
        status.textContent = `Created ${filename}! Commit: ${result.commit.sha.slice(0, 7)}`;
      }

      // Update local index to add the new file
      if (wikiIndex) {
        const repo = wikiIndex.repos.find(r => r.name === repoName);
        if (repo) {
          if (!repo.markdownFiles) repo.markdownFiles = [];
          repo.markdownFiles.push({
            relativePath: filename,
            name: filename,
            fileType: filename.split('.').pop()
          });
        }
      }

      // Close modal and refresh table after delay
      setTimeout(() => {
        closeRepoDocModal();
        loadQuickView();
      }, 1500);
    } else {
      if (status) {
        status.className = 'editor-status error';
        status.textContent = result.error || 'Failed to save';
      }
    }
  } catch (err) {
    console.error('Error saving repo doc:', err);
    if (status) {
      status.className = 'editor-status error';
      status.textContent = 'Network error. Please try again.';
    }
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save & Commit';
    }
  }
}

// Make functions available globally
window.openRepoDocEditor = openRepoDocEditor;
window.closeRepoDocModal = closeRepoDocModal;
window.saveRepoDoc = saveRepoDoc;

// ============================================
// DOCS FILES MODULE
// ============================================

// Get all doc files from both wiki documents and repo markdown files
function getAllDocFiles() {
  if (!wikiIndex) return [];
  const files = [];

  // Wiki documents
  wikiIndex.documents.forEach(doc => {
    files.push({
      name: doc.title,
      path: doc.relativePath,
      date: doc.updated || '',
      type: 'wiki',
      source: doc.category,
    });
  });

  // Repo markdown files
  wikiIndex.repos.forEach(repo => {
    if (!repo.markdownFiles) return;
    const repoDate = repo.lastCommitDate
      ? repo.lastCommitDate.split('T')[0]
      : '';
    const githubBaseUrl = repo.githubUrl ? repo.githubUrl.replace(/\.git$/, '') : null;
    repo.markdownFiles.forEach(file => {
      files.push({
        name: file.name,
        path: file.relativePath,
        date: repoDate,
        type: 'repo-file',
        source: repo.name,
        githubUrl: githubBaseUrl,
      });
    });
  });

  return files;
}

// Render "Recently Modified Docs" section on the main page
function renderRecentDocs() {
  const container = document.getElementById('recent-docs-container');
  if (!container || !wikiIndex) return;

  const files = getAllDocFiles()
    .filter(f => f.date)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);

  if (files.length === 0) {
    container.innerHTML = '<p class="placeholder-text">No recent documents found</p>';
    return;
  }

  let html = '<table class="recent-docs-table"><thead><tr><th>File</th><th>Date</th></tr></thead><tbody>';

  files.forEach(file => {
    const dateDisplay = file.date || '-';
    if (file.type === 'wiki') {
      html += `<tr class="recent-doc-row" data-type="wiki" data-path="${escapeHtml(file.path)}">`;
      html += `<td><span class="recent-doc-name">${escapeHtml(file.name)}</span> <span class="recent-doc-source">${escapeHtml(file.source)}</span></td>`;
    } else {
      const fileUrl = file.githubUrl ? `${file.githubUrl}/blob/main/${file.path}` : '#';
      html += `<tr class="recent-doc-row" data-type="repo-file" data-url="${escapeHtml(fileUrl)}">`;
      html += `<td><span class="recent-doc-name">${escapeHtml(file.name)}</span> <span class="recent-doc-source">${escapeHtml(file.source)}</span></td>`;
    }
    html += `<td class="recent-doc-date">${escapeHtml(dateDisplay)}</td>`;
    html += '</tr>';
  });

  html += '</tbody></table>';
  html += '<div class="recent-docs-footer"><a href="/browse?tab=docs" class="recent-docs-link" id="view-all-docs-link">View all docs &rarr;</a></div>';

  container.innerHTML = html;

  // Click handlers for rows
  container.querySelectorAll('.recent-doc-row').forEach(row => {
    row.addEventListener('click', () => {
      if (row.dataset.type === 'wiki') {
        navigateTo('document', { doc: row.dataset.path });
      } else if (row.dataset.url && row.dataset.url !== '#') {
        window.open(row.dataset.url, '_blank');
      }
    });
  });

  // "View all docs" link handler
  const viewAllLink = document.getElementById('view-all-docs-link');
  if (viewAllLink) {
    viewAllLink.addEventListener('click', (e) => {
      e.preventDefault();
      history.pushState({ page: 'browse', tab: 'docs' }, '', '/browse?tab=docs');
      showPage('browse', { tab: 'docs' });
    });
  }
}

// Docs View state
let docsViewSort = { field: 'date', direction: 'desc' };
let docsViewPage = 1;
const DOCS_PER_PAGE = 100;

// Render full Docs View tab on Browse page
function renderDocsView() {
  const container = document.getElementById('repo-docs-content');
  if (!container || !wikiIndex) return;

  const allFiles = getAllDocFiles();

  // Sort
  const sorted = [...allFiles].sort((a, b) => {
    let cmp = 0;
    if (docsViewSort.field === 'name') {
      cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    } else if (docsViewSort.field === 'date') {
      cmp = (a.date || '').localeCompare(b.date || '');
    }
    return docsViewSort.direction === 'asc' ? cmp : -cmp;
  });

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sorted.length / DOCS_PER_PAGE));
  docsViewPage = Math.min(docsViewPage, totalPages);
  const start = (docsViewPage - 1) * DOCS_PER_PAGE;
  const pageFiles = sorted.slice(start, start + DOCS_PER_PAGE);

  // Sort controls
  const nameArrow = docsViewSort.field === 'name' ? (docsViewSort.direction === 'asc' ? ' &#9650;' : ' &#9660;') : '';
  const dateArrow = docsViewSort.field === 'date' ? (docsViewSort.direction === 'asc' ? ' &#9650;' : ' &#9660;') : '';

  let html = `<div class="docs-view-header"><span class="docs-view-count">${sorted.length} doc files</span></div>`;

  html += '<table class="docs-view-table"><thead><tr>';
  html += `<th class="sortable" data-sort="name">File${nameArrow}</th>`;
  html += '<th>Source</th>';
  html += `<th class="sortable" data-sort="date">Date${dateArrow}</th>`;
  html += '</tr></thead><tbody>';

  pageFiles.forEach(file => {
    const dateDisplay = file.date || '-';
    const icon = file.type === 'wiki' ? '📝' : getFileTypeIcon(file.path.split('.').pop() || 'md');

    html += '<tr>';
    if (file.type === 'wiki') {
      html += `<td><span class="file-icon">${icon}</span> <a href="#" class="docs-view-link" data-type="wiki" data-path="${escapeHtml(file.path)}">${escapeHtml(file.name)}</a></td>`;
    } else {
      const fileUrl = file.githubUrl ? `${file.githubUrl}/blob/main/${file.path}` : '#';
      html += `<td><span class="file-icon">${icon}</span> <a href="${escapeHtml(fileUrl)}" target="_blank">${escapeHtml(file.name)}</a></td>`;
    }
    html += `<td class="docs-view-source">${escapeHtml(file.source)}</td>`;
    html += `<td class="docs-view-date">${escapeHtml(dateDisplay)}</td>`;
    html += '</tr>';
  });

  html += '</tbody></table>';

  // Pagination controls
  if (totalPages > 1) {
    html += '<div class="pagination">';
    html += `<button class="btn btn-sm btn-secondary" id="docs-prev-page" ${docsViewPage <= 1 ? 'disabled' : ''}>Previous</button>`;
    html += `<span class="pagination-info">Page ${docsViewPage} of ${totalPages}</span>`;
    html += `<button class="btn btn-sm btn-secondary" id="docs-next-page" ${docsViewPage >= totalPages ? 'disabled' : ''}>Next</button>`;
    html += '</div>';
  }

  container.innerHTML = html;

  // Sort click handlers
  container.querySelectorAll('.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const field = th.dataset.sort;
      if (docsViewSort.field === field) {
        docsViewSort.direction = docsViewSort.direction === 'asc' ? 'desc' : 'asc';
      } else {
        docsViewSort.field = field;
        docsViewSort.direction = field === 'date' ? 'desc' : 'asc';
      }
      docsViewPage = 1;
      renderDocsView();
    });
  });

  // Wiki doc link handlers
  container.querySelectorAll('.docs-view-link[data-type="wiki"]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo('document', { doc: link.dataset.path });
    });
  });

  // Pagination handlers
  const prevBtn = document.getElementById('docs-prev-page');
  const nextBtn = document.getElementById('docs-next-page');
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (docsViewPage > 1) { docsViewPage--; renderDocsView(); }
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (docsViewPage < totalPages) { docsViewPage++; renderDocsView(); }
    });
  }
}

// ============================================
// EDITABLE NOTES MODULE
// ============================================

// Render notes cell with edit capability
// Uses data attributes to safely store note text with special characters
function renderNotesCell(repoName, noteText) {
  const escapedRepoName = escapeHtml(repoName);
  const escapedNote = escapeHtml(noteText);

  if (currentUser) {
    // Logged in - show editable notes (clickable, styled with color)
    // Store note in data attribute to avoid inline handler escaping issues
    return `
      <div class="notes-content" data-repo="${escapedRepoName}" data-note="${escapedNote}">
        <span class="notes-text">${noteText ? escapedNote : '<span class="no-notes">-</span>'}</span>
      </div>
    `;
  } else {
    // Not logged in - read-only notes
    return noteText ? escapedNote : '<span class="no-notes">-</span>';
  }
}

// Start editing a note - reads note from data attribute
function startEditNote(repoName) {
  // Find all notes cells for this repo
  const notesContents = document.querySelectorAll(`.notes-content[data-repo="${repoName}"]`);
  if (notesContents.length === 0) return;

  // Get current note from data attribute
  const currentNote = notesContents[0].dataset.note || '';

  notesContents.forEach(container => {
    // Create edit form
    const form = document.createElement('div');
    form.className = 'notes-edit-form';

    const textarea = document.createElement('textarea');
    textarea.className = 'notes-edit-input';
    textarea.value = currentNote;
    textarea.placeholder = 'Add a note...';
    textarea.rows = 2;

    const saveBtn = document.createElement('button');
    saveBtn.className = 'notes-save-btn';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      saveNote(repoName);
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'notes-cancel-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      cancelEditNote(repoName);
    });

    form.appendChild(textarea);
    form.appendChild(saveBtn);
    form.appendChild(cancelBtn);

    container.innerHTML = '';
    container.appendChild(form);

    // Focus textarea and handle keyboard
    textarea.focus();
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        // Enter without Shift saves
        e.preventDefault();
        saveNote(repoName);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelEditNote(repoName);
      }
      // Shift+Enter allows normal newline behavior
    });
  });
}

// Cancel editing a note - restores display from data attribute
function cancelEditNote(repoName) {
  const notesContents = document.querySelectorAll(`.notes-content[data-repo="${repoName}"]`);

  notesContents.forEach(container => {
    const originalNote = container.dataset.note || '';
    container.innerHTML = `
      <span class="notes-text">${originalNote ? escapeHtml(originalNote) : '<span class="no-notes">-</span>'}</span>
    `;
  });
}

// Save a note
async function saveNote(repoName) {
  const notesContents = document.querySelectorAll(`.notes-content[data-repo="${repoName}"]`);
  if (notesContents.length === 0) return;

  // Get the new note value from the textarea
  const textarea = notesContents[0].querySelector('.notes-edit-input');
  if (!textarea) return;

  const newNote = textarea.value.trim();

  // Show saving state in all matching cells
  notesContents.forEach(container => {
    container.innerHTML = '<span class="notes-saving">Saving...</span>';
  });

  try {
    const response = await fetch('/.netlify/functions/save-note', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        repoName: repoName,
        note: newNote,
      }),
    });

    const result = await response.json();

    if (response.ok && result.success) {
      // Update local index
      if (wikiIndex) {
        const repo = wikiIndex.repos.find(r => r.name === repoName);
        if (repo) {
          repo.notes = newNote;
        }
      }

      // Update UI with new value and update data attribute
      notesContents.forEach(container => {
        container.dataset.note = newNote;
        container.innerHTML = `
          <span class="notes-text">${newNote ? escapeHtml(newNote) : '<span class="no-notes">-</span>'}</span>
        `;
      });
    } else {
      // Show error and restore edit state
      alert(result.error || 'Failed to save note');
      // Restore the data attribute and try editing again
      notesContents.forEach(container => {
        container.dataset.note = newNote;
      });
      startEditNote(repoName);
    }
  } catch (err) {
    console.error('Error saving note:', err);
    alert('Network error. Please try again.');
    notesContents.forEach(container => {
      container.dataset.note = newNote;
    });
    startEditNote(repoName);
  }
}

// Set up event delegation for notes clicking
function setupNotesEventDelegation() {
  document.addEventListener('click', (e) => {
    const notesContent = e.target.closest('.notes-content');
    if (notesContent && !e.target.closest('.notes-edit-form')) {
      const repoName = notesContent.dataset.repo;
      if (repoName) {
        startEditNote(repoName);
      }
    }
  });
}

// Initialize notes event delegation on load
setupNotesEventDelegation();

// Make functions available globally (for debugging)
window.startEditNote = startEditNote;
window.cancelEditNote = cancelEditNote;
window.saveNote = saveNote;

// Initialize on load
document.addEventListener('DOMContentLoaded', init);
