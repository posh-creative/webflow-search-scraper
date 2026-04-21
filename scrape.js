const axios = require('axios');
const cheerio = require('cheerio');
const xml2js = require('xml2js');
const fs = require('fs');

// ==========================================
// 🚀 ADD NEW CLIENT WEBSITES HERE
// ==========================================
const CONFIG = [
    {
        name: 'alliance', // This creates alliance-index.json
        sitemap: 'https://www.alliancemedical.co.uk/sitemap.xml',
        rules: [
            // Matches the URL path to assign priority and category
            { match: '/scanning-centres/', priority: 100, category: 'Center' },
            { match: '/scan-centres/', priority: 100, category: 'Center' },
            { match: '/scan-type/', priority: 100, category: 'Service' },
            { match: '/diagnostic-services/', priority: 100, category: 'Service' },
            { match: '/for-patients/', priority: 50, category: 'Patient Info' },
            { match: '/for-referrers/', priority: 50, category: 'Referrer Info' },
            { match: '/news/', priority: 20, category: 'News' },
            { match: '/blog/', priority: 20, category: 'Blog' }
        ]
    },
    {
        name: 'poshcreative', // This creates poshcreative-index.json
        sitemap: 'https://www.poshcreative.co.uk/sitemap.xml', // Replace with real sitemap
        rules: [
            { match: '/portfolio/', priority: 100, category: 'Work' },
            { match: '/services/', priority: 80, category: 'Services' }
        ]
    }
];
// ==========================================

async function scrapeSites() {
    for (const site of CONFIG) {
        console.log(`\n🔍 Starting scrape for: ${site.name.toUpperCase()}`);
        const searchIndex = [];

        try {
            const { data: sitemapXml } = await axios.get(site.sitemap);
            const parser = new xml2js.Parser();
            const sitemapObj = await parser.parseStringPromise(sitemapXml);

            const urls = sitemapObj.urlset.url.map(entry => entry.loc[0]);
            console.log(`Found ${urls.length} URLs for ${site.name}.`);

            for (const url of urls) {
                try {
                    const { data: html } = await axios.get(url);
                    const $ = cheerio.load(html);

                    const title = $('title').text() || $('h1').first().text();
                    let description = $('meta[name="description"]').attr('content') || 
                                      $('meta[property="og:description"]').attr('content') || '';
                    
                    if (!description) {
                        description = $('p').first().text().trim().substring(0, 150) + '...';
                    }

                    // ==========================================
                    // 📸 NEW: IMAGE SCRAPING LOGIC
                    // ==========================================
                    let imageUrl = $('meta[property="og:image"]').attr('content') || 
                                   $('meta[name="twitter:image"]').attr('content');
                    
                    if (!imageUrl) {
                        // Fallback: Find the first actual image that isn't a logo or SVG
                        const firstImg = $('img').not('[src*="logo"], [src*=".svg"]').first().attr('src');
                        if (firstImg) {
                            // Ensure it's a full absolute URL
                            const domain = new URL(url).origin;
                            imageUrl = firstImg.startsWith('http') ? firstImg : `${domain}${firstImg.startsWith('/') ? '' : '/'}${firstImg}`;
                        }
                    }
                    // ==========================================

                    // Default Fallback
                    let priority = 10;
                    let category = "Page";

                    // Check URL against the site's rules
                    let matchedRule = false;
                    for (const rule of site.rules) {
                        if (url.includes(rule.match)) {
                            priority = rule.priority;
                            category = rule.category;
                            matchedRule = true;
                            break; 
                        }
                    }

                    // If it didn't match a deep folder, see if it's a Top Level Page (e.g., domain.com/about)
                    // We check this by counting the slashes in the URL
                    if (!matchedRule) {
                        const path = url.replace(/^(?:\/\/|[^/]+)*\//, ''); // removes domain
                        if (!path.includes('/')) {
                            priority = 100; // Top level pages get 100!
                            category = "Main Page";
                        }
                    }

                    searchIndex.push({
                        title: title.trim(),
                        url: url, 
                        description: description.trim(),
                        image: imageUrl || '', // Adds the image to the JSON
                        category: category,
                        priority: priority
                    });
                    
                    console.log(`✅ Scraped: ${url}`);
                } catch (err) {
                    console.error(`❌ Error scraping ${url}`);
                }
            }

            // Save specific JSON file for this site
            fs.writeFileSync(`${site.name}-index.json`, JSON.stringify(searchIndex, null, 2));
            console.log(`🎉 Saved ${site.name}-index.json!`);

        } catch (error) {
            console.error(`Failed to process sitemap for ${site.name}:`, error.message);
        }
    }
}

scrapeSites();