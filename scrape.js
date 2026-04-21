const axios = require('axios');
const cheerio = require('cheerio');
const xml2js = require('xml2js');
const fs = require('fs');

const CONFIG = [
    {
        name: 'alliance',
        sitemap: 'https://www.alliancemedical.co.uk/sitemap.xml',
        rules: [
            { match: '/scanning-centres/', priority: 100, category: 'Center' },
            { match: '/scan-centres/', priority: 100, category: 'Center' },
            { match: '/scan-type/', priority: 100, category: 'Service' },
            { match: '/diagnostic-services/', priority: 100, category: 'Service' },
            { match: '/for-patients/', priority: 50, category: 'Patient Info' },
            { match: '/for-referrers/', priority: 50, category: 'Referrer Info' },
            { match: '/news/', priority: 20, category: 'News' },
            { match: '/blog/', priority: 20, category: 'Blog' }
        ]
    }
];

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
                    // 📸 THE ANTI-JUNK IMAGE SCRAPER
                    // ==========================================
                    let imageUrl = $('meta[property="og:image"]').attr('content') || 
                                   $('meta[name="twitter:image"]').attr('content');
                    
                    if (!imageUrl) {
                        const images = $('img');
                        for (let i = 0; i < images.length; i++) {
                            const src = $(images[i]).attr('src') || '';
                            const srcLower = src.toLowerCase();
                            
                            // Kill words that mean it's a UI element
                            const isJunk = srcLower.includes('logo') || 
                                           srcLower.includes('icon') || 
                                           srcLower.includes('close') || 
                                           srcLower.includes('arrow') || 
                                           srcLower.includes('bg') || 
                                           srcLower.includes('menu') || 
                                           srcLower.includes('placeholder') || 
                                           src.startsWith('data:');

                            if (src && !isJunk) {
                                // Double check it looks like a real photo format
                                if (srcLower.includes('.jpg') || srcLower.includes('.jpeg') || srcLower.includes('.png') || srcLower.includes('.webp')) {
                                    imageUrl = src;
                                    break; // Found a real photo! Stop searching.
                                }
                            }
                        }

                        // Make sure the URL is absolute
                        if (imageUrl && !imageUrl.startsWith('http')) {
                            const domain = new URL(url).origin;
                            imageUrl = `${domain}${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`;
                        }
                    }
                    // ==========================================

                    let priority = 10;
                    let category = "Page";
                    let matchedRule = false;
                    for (const rule of site.rules) {
                        if (url.includes(rule.match)) {
                            priority = rule.priority;
                            category = rule.category;
                            matchedRule = true;
                            break; 
                        }
                    }

                    if (!matchedRule) {
                        const path = url.replace(/^(?:\/\/|[^/]+)*\//, ''); 
                        if (!path.includes('/')) {
                            priority = 100; 
                            category = "Main Page";
                        }
                    }

                    searchIndex.push({
                        title: title.trim(),
                        url: url, 
                        description: description.trim(),
                        image: imageUrl || '', 
                        category: category,
                        priority: priority
                    });
                    
                    console.log(`✅ Scraped: ${url}`);
                } catch (err) {
                    console.error(`❌ Error scraping ${url}`);
                }
            }

            fs.writeFileSync(`${site.name}-index.json`, JSON.stringify(searchIndex, null, 2));
            console.log(`🎉 Saved ${site.name}-index.json!`);

        } catch (error) {
            console.error(`Failed to process sitemap for ${site.name}:`, error.message);
        }
    }
}

scrapeSites();
