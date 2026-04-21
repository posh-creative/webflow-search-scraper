const axios = require('axios');
const cheerio = require('cheerio');
const xml2js = require('xml2js');
const fs = require('fs');

// ==========================================
// 🚀 CLIENT CONFIGURATION
// ==========================================
const CONFIG =[
    {
        name: 'alliance',
        sitemap: 'https://www.alliancemedical.co.uk/sitemap.xml',
        rules:[
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
        name: 'poshcreative',
        sitemap: 'https://www.poshcreative.co.uk/sitemap.xml',
        rules:[
            { match: '/portfolio/', priority: 100, category: 'Work' },
            { match: '/services/', priority: 80, category: 'Services' }
        ]
    }
];
// ==========================================

async function scrapeSites() {
    for (const site of CONFIG) {
        console.log(`\n🔍 Starting scrape for: ${site.name.toUpperCase()}`);
        const searchIndex =[];

        try {
            const { data: sitemapXml } = await axios.get(site.sitemap);
            const parser = new xml2js.Parser();
            const sitemapObj = await parser.parseStringPromise(sitemapXml);

            const urls = sitemapObj.urlset.url.map(entry => entry.loc[0]);
            console.log(`Found ${urls.length} URLs for ${site.name}. Scraping pages...`);

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
                    // 📸 BULLETPROOF IMAGE SCRAPING LOGIC
                    // ==========================================
                    
                    // 1. Try Meta Image first (usually the highest quality representation 1200x630+)
                    let imageUrl = $('meta[property="og:image"]').attr('content') || 
                                   $('meta[name="twitter:image"]').attr('content');
                    
                    // Reject the meta image if it's explicitly just a site logo
                    if (imageUrl && imageUrl.toLowerCase().includes('logo')) {
                        imageUrl = null;
                    }
                    
                    if (!imageUrl) {
                        const images = $('img');
                        
                        for (let i = 0; i < images.length; i++) {
                            const imgEl = $(images[i]);
                            let src = imgEl.attr('src') || '';
                            const srcLower = src.toLowerCase();
                            const classNames = (imgEl.attr('class') || '').toLowerCase();
                            const altText = (imgEl.attr('alt') || '').toLowerCase();
                            
                            // 🛑 RUTHLESS JUNK FILTER: Checks URL, CSS Classes, AND Alt Text!
                            const isJunk = src.startsWith('data:') || 
                                           srcLower.includes('.svg') || 
                                           srcLower.includes('logo') || classNames.includes('logo') || altText.includes('logo') ||
                                           srcLower.includes('icon') || classNames.includes('icon') || altText.includes('icon') ||
                                           srcLower.includes('avatar') || classNames.includes('avatar') || altText.includes('avatar') ||
                                           srcLower.includes('close') || classNames.includes('close') ||
                                           srcLower.includes('arrow') || classNames.includes('arrow') ||
                                           srcLower.includes('bg') || 
                                           srcLower.includes('placeholder') ||
                                           classNames.includes('nav') || classNames.includes('footer');

                            // 🛑 THUMBNAIL FILTER: Reject explicit thumbnail file names
                            const isThumbnail = /-\d{2,3}x\d{2,3}\./.test(srcLower) || srcLower.includes('thumb');

                            // If it fails the junk check, move immediately to next image
                            if (!src || isJunk || isThumbnail) continue;

                            // 🛑 FORMAT FILTER: Must be a standard photo format
                            if (!srcLower.match(/\.(jpg|jpeg|png|webp)(\?.*)?$/)) continue;

                            let finalImageSrc = src;
                            let resolvedWidth = 0;

                            // ✅ WEBFLOW SRCSET PARSER
                            // Webflow generates responsive images. We read the srcset to find the exact widths available
                            // and grab the absolute largest resolution image Webflow offers.
                            const srcset = imgEl.attr('srcset');
                            if (srcset) {
                                const sources = srcset.split(',').map(s => s.trim().split(' '));
                                let largestWidth = 0;
                                let largestSrc = src;

                                sources.forEach(source => {
                                    if (source.length === 2) {
                                        const w = parseInt(source[1].replace('w', '')) || 0;
                                        if (w > largestWidth) {
                                            largestWidth = w;
                                            largestSrc = source[0];
                                        }
                                    }
                                });

                                if (largestWidth > 0) {
                                    resolvedWidth = largestWidth;
                                    finalImageSrc = largestSrc; 
                                }
                            }

                            // ✅ FALLBACK TO HTML WIDTH ATTRIBUTE
                            if (resolvedWidth === 0) {
                                const rawWidth = imgEl.attr('width');
                                if (rawWidth) {
                                    resolvedWidth = parseInt(rawWidth, 10) || 0;
                                }
                            }

                            // 🛑 THE "NO GUESSING" BULLETPROOF RULE (>= 1600px)
                            // If resolvedWidth is STILL 0, it means the image has no width tag and no srcset.
                            // In Webflow, real photos almost always have a srcset. Tiny UI graphics don't.
                            // If it's 0, we assume it's small garbage and reject it.
                            if (resolvedWidth < 1600) {
                                continue; 
                            }

                            // If it survived all of this, it is a certified massive image!
                            imageUrl = finalImageSrc;
                            break; 
                        }

                        // Convert relative paths to absolute URLs
                        if (imageUrl && !imageUrl.startsWith('http')) {
                            const domain = new URL(url).origin;
                            imageUrl = `${domain}${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`;
                        }
                    }
                    // ==========================================

                    // Assign Priority & Category
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
