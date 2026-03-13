const PASSWORD = 'PLACEHOLDER_PASSWORD';
const API_BASE = window.API_BASE || '';

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const loginForm = document.getElementById('login-form');
const passwordInput = document.getElementById('password');
const loginError = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const resultsContainer = document.getElementById('results-container');
const loading = document.getElementById('loading');
const errorMessage = document.getElementById('error-message');
const filterCity = document.getElementById('filter-city');
const filterCountry = document.getElementById('filter-country');
const filterRegion = document.getElementById('filter-region');
const nResultsInput = document.getElementById('n-results');

// State
let isAuthenticated = false;

// Initialize
function init() {
    checkAuth();
    setupEventListeners();
}

function checkAuth() {
    const storedAuth = localStorage.getItem('search_auth');
    if (storedAuth === 'true') {
        isAuthenticated = true;
        showApp();
    }
}

function setupEventListeners() {
    // Login
    loginForm.addEventListener('submit', handleLogin);
    
    // Logout
    logoutBtn.addEventListener('click', handleLogout);
    
    // Search
    searchBtn.addEventListener('click', handleSearch);
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSearch();
    });
    
    // Filters - load unique values
    loadFilters();
}

function handleLogin(e) {
    e.preventDefault();
    const password = passwordInput.value;
    
    if (password === PASSWORD) {
        isAuthenticated = true;
        localStorage.setItem('search_auth', 'true');
        showApp();
        loginError.classList.add('hidden');
    } else {
        loginError.classList.remove('hidden');
        passwordInput.value = '';
    }
}

function handleLogout() {
    isAuthenticated = false;
    localStorage.removeItem('search_auth');
    showLogin();
    passwordInput.value = '';
    loginError.classList.add('hidden');
}

function showLogin() {
    loginScreen.classList.remove('hidden');
    appScreen.classList.add('hidden');
}

function showApp() {
    loginScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
}

async function loadFilters() {
    try {
        const response = await fetch(`${API_BASE}/stats`);
        if (!response.ok) throw new Error('Failed to load filters');
        
        const stats = await response.json();
        
        // Populate filter dropdowns with unique values from results
        if (stats.cities) {
            stats.cities.forEach(city => {
                const option = document.createElement('option');
                option.value = city;
                option.textContent = city;
                filterCity.appendChild(option);
            });
        }
        
        if (stats.countries) {
            stats.countries.forEach(country => {
                const option = document.createElement('option');
                option.value = country;
                option.textContent = country;
                filterCountry.appendChild(option);
            });
        }
        
        if (stats.regions) {
            stats.regions.forEach(region => {
                const option = document.createElement('option');
                option.value = region;
                option.textContent = region;
                filterRegion.appendChild(option);
            });
        }
    } catch (err) {
        console.log('Could not load filters:', err.message);
    }
}

async function handleSearch() {
    const query = searchInput.value.trim();
    if (!query) return;
    
    showLoading();
    hideError();
    
    try {
        const params = new URLSearchParams({
            q: query,
            n: nResultsInput.value || 10
        });
        
        if (filterCity.value) params.append('city', filterCity.value);
        if (filterCountry.value) params.append('country', filterCountry.value);
        if (filterRegion.value) params.append('region', filterRegion.value);
        
        const response = await fetch(`${API_BASE}/search?${params}`);
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Search failed');
        }
        
        const results = await response.json();
        displayResults(results);
    } catch (err) {
        showError(err.message);
    } finally {
        hideLoading();
    }
}

function displayResults(results) {
    resultsContainer.innerHTML = '';
    
    if (!results || results.length === 0) {
        resultsContainer.innerHTML = '<p class="placeholder">No results found. Try different keywords or filters.</p>';
        return;
    }
    
    results.forEach(result => {
        const card = document.createElement('div');
        card.className = 'result-card';
        
        const similarity = (result.similarity * 100).toFixed(1);
        
        const location = [];
        if (result.metadata?.city) location.push(result.metadata.city);
        if (result.metadata?.region) location.push(result.metadata.region);
        if (result.metadata?.country) location.push(result.metadata.country);
        
        card.innerHTML = `
            <div class="result-header">
                <span class="result-name">${escapeHtml(result.member_name)}</span>
                <span class="result-similarity">${similarity}% match</span>
            </div>
            <p class="result-text">${escapeHtml(result.text)}</p>
            ${location.length > 0 ? `
                <div class="result-meta">
                    <span class="location">📍 ${escapeHtml(location.join(', '))}</span>
                </div>
            ` : ''}
        `;
        
        resultsContainer.appendChild(card);
    });
}

function showLoading() {
    loading.classList.remove('hidden');
    resultsContainer.innerHTML = '';
}

function hideLoading() {
    loading.classList.add('hidden');
}

function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.remove('hidden');
}

function hideError() {
    errorMessage.classList.add('hidden');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Start
init();
