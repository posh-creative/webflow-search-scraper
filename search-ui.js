document.addEventListener("DOMContentLoaded", function () {
  // 1. Figure out which site we are on and bypass cache
  const scriptTag = document.getElementById("posh-search-script");
  const indexName = scriptTag ? scriptTag.getAttribute("data-index") : "alliance-index.json";
  const cacheBuster = new Date().getTime();
  
  // Using RAW GitHub content so it updates instantly without CDN cache delays
  const dataUrl = `https://raw.githubusercontent.com/posh-creative/webflow-search-scraper/main/${indexName}?v=${cacheBuster}`;

  // 2. Grab DOM Elements
  const triggerBtn = document.getElementById("premium-search-trigger");
  const overlay = document.getElementById("premium-search-overlay");
  const closeBtn = document.getElementById("close-search-btn");
  const inputField = document.getElementById("search-input-field");
  const resultsArea = document.getElementById("search-results-wrapper");

  let fuse;

  // 3. Load Fuse.js Dynamically
  const fuseScript = document.createElement("script");
  fuseScript.src = "https://cdn.jsdelivr.net/npm/fuse.js/dist/fuse.min.js";
  document.head.appendChild(fuseScript);

  fuseScript.onload = async function () {
    try {
      const response = await fetch(dataUrl);
      if (!response.ok) throw new Error("Could not find the JSON search index.");
      
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
      if(resultsArea) resultsArea.innerHTML = `<div class="empty-state-text" style="color:#ef4444;">Error loading search data. Please check GitHub.</div>`;
      console.error("Search Error:", error); 
    }
  };

  // 4. Modal Controls
  function openSearch() {
    if(overlay) overlay.classList.add("is-active");
    if(inputField) setTimeout(() => inputField.focus(), 100);
    document.body.style.overflow = "hidden"; // Prevents background scrolling
  }

  function closeSearch() {
    if(overlay) overlay.classList.remove("is-active");
    if(inputField) inputField.value = "";
    if(resultsArea) resultsArea.innerHTML = '<div class="empty-state-text">Start typing to search...</div>';
    document.body.style.overflow = ""; 
  }

  // Event Listeners for Open/Close
  if(triggerBtn) triggerBtn.addEventListener("click", openSearch);
  if(closeBtn) closeBtn.addEventListener("click", closeSearch);
  if(overlay) overlay.addEventListener("click", (e) => { if (e.target === overlay) closeSearch(); });

  // Cmd+K and Esc Shortcuts
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      openSearch();
    }
    if (e.key === "Escape" && overlay && overlay.classList.contains("is-active")) {
      closeSearch();
    }
  });

  // 5. Search Logic & Rendering
  if(inputField) {
    inputField.addEventListener("input", function (e) {
      if (!fuse) return;
      const query = e.target.value;

      if (query.length < 2) {
        resultsArea.innerHTML = '<div class="empty-state-text">Start typing to search...</div>';
        return;
      }

      let results = fuse.search(query);
      
      // Sort by Priority (Forces Centres & Services to the top)
      results.sort((a, b) => b.item.priority - a.item.priority);

      resultsArea.innerHTML = "";
      if (results.length > 0) {
        results.slice(0, 10).forEach((result, index) => {
          const item = result.item;
          
          // Update this block inside your search-ui.js (around line 72)
          // ==========================================
          const imgHtml = item.image 
            ? `<img src="${item.image}" alt="${item.title}" class="card-img">`
            : `<div class="card-img-placeholder"><i class="fi fi-rr-document"></i></div>`; // Changed to Flaticon

          const animDelay = index * 0.05;

          resultsArea.innerHTML += `
            <a href="${item.url}" class="search-card" style="animation-delay: ${animDelay}s;">
              <div class="card-img-wrapper">
                ${imgHtml}
              </div>
              <div class="card-content">
                <span class="card-badge">${item.category}</span>
                <span class="card-title">${item.title}</span>
                <span class="card-desc">${item.description}</span>
              </div>
              <div class="card-arrow"><i class="fi fi-rr-angle-small-right"></i></div> <!-- Changed to Flaticon -->
            </a>
          `;
         
        });
      } else {
        resultsArea.innerHTML = `<div class="empty-state-text">No results found for "${query}"</div>`;
      }
    });
  }
});
