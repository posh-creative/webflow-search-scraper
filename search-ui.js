document.addEventListener("DOMContentLoaded", function () {
  // 1. Find the script tag to know WHICH json file to load
  const scriptTag = document.getElementById("posh-search-script");
  const indexName = scriptTag ? scriptTag.getAttribute("data-index") : "alliance-index.json";
  
  // Cache-buster: Forces the browser to get the newest file, ignoring the CDN cache!
  const cacheBuster = new Date().getTime();
  const dataUrl = `https://cdn.jsdelivr.net/gh/posh-creative/webflow-search-scraper@main/${indexName}?v=${cacheBuster}`;

  // 2. Grab the HTML elements
  const triggerBtn = document.getElementById("premium-search-trigger");
  const overlay = document.getElementById("premium-search-overlay");
  const closeBtn = document.getElementById("close-search-btn");
  const inputField = document.getElementById("search-input-field");
  const resultsArea = document.getElementById("search-results-wrapper");

  let fuse;

  // 3. Load Fuse.js dynamically (So you don't have to add it manually in Webflow)
  const fuseScript = document.createElement("script");
  fuseScript.src = "https://cdn.jsdelivr.net/npm/fuse.js/dist/fuse.min.js";
  document.head.appendChild(fuseScript);

  fuseScript.onload = async function () {
    try {
      const response = await fetch(dataUrl);
      const searchData = await response.json();

      fuse = new Fuse(searchData, {
        keys: [
          { name: "title", weight: 4 },
          { name: "category", weight: 2 },
          { name: "description", weight: 1 }
        ],
        threshold: 0.3,
        includeScore: true
      });
    } catch (error) {
      resultsArea.innerHTML = `<div class="empty-state-text" style="color:#ef4444;">Error loading search data. Check GitHub.</div>`;
      console.error("Search Error:", error);
    }
  };

  // 4. Modal Open/Close Logic
  function openSearch() {
    overlay.classList.add("is-active");
    setTimeout(() => inputField.focus(), 100);
  }

  function closeSearch() {
    overlay.classList.remove("is-active");
    inputField.value = "";
    resultsArea.innerHTML = '<div class="empty-state-text">Start typing to search...</div>';
  }

  if(triggerBtn) triggerBtn.addEventListener("click", openSearch);
  if(closeBtn) closeBtn.addEventListener("click", closeSearch);
  
  if(overlay) {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeSearch();
    });
  }

  // Keyboard Shortcuts (Cmd+K and Esc)
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      openSearch();
    }
    if (e.key === "Escape" && overlay.classList.contains("is-active")) {
      closeSearch();
    }
  });

  // 5. Typing and Rendering
  if(inputField) {
    inputField.addEventListener("input", function (e) {
      if (!fuse) return;
      const query = e.target.value;

      if (query.length < 2) {
        resultsArea.innerHTML = '<div class="empty-state-text">Start typing to search...</div>';
        return;
      }

      let results = fuse.search(query);
      results.sort((a, b) => b.item.priority - a.item.priority); // High priority at top

      resultsArea.innerHTML = "";
      if (results.length > 0) {
        results.slice(0, 10).forEach((result) => {
          const item = result.item;
          resultsArea.innerHTML += `
            <a href="${item.url}" class="search-card">
              <div class="card-top">
                <span class="card-title">${item.title}</span>
                <span class="card-badge">${item.category}</span>
              </div>
              <div class="card-desc">${item.description}</div>
            </a>
          `;
        });
      } else {
        resultsArea.innerHTML = `<div class="empty-state-text">No results found for "${query}"</div>`;
      }
    });
  }
});