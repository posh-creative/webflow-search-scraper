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
            { match: '/scan-centres/', priority: 80, category: 'Center' },
            { match: '/scan-type/', priority: 70, category: 'Service' },
            { match: '/diagnostic-services/', priority: 60, category: 'Service' },
            { match: '/for-patients/', priority: 50, category: 'Patient Info' },
            { match: '/for-referrers/', priority: 40, category: 'Referrer Info' },
            { match: '/news/', priority: 30, category: 'News' },
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
        const rawPages =[];

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
                    
                    // ==========================================
                    // 📝 BETTER DESCRIPTION FINDER
                    // ==========================================
                    let description = $('meta[name="description"]').attr('content') || 
                                      $('meta[property="og:description"]').attr('content') || '';
                    
                    if (!description) {
                        // Find the first paragraph that actually has a real sentence (over 40 chars)
                        // This stops it from grabbing short addresses like "Hills Road, Cambridge..."
                        const paragraphs = $('p');
                        for (let i = 0; i < paragraphs.length; i++) {
                            const text = $(paragraphs[i]).text().trim();
                            if (text.length > 40) {
                                description = text.substring(0, 150) + '...';
                                break;
                            }
                        }
                    }

                    // ==========================================
                    // 📸 CANDIDATE IMAGE FINDER (Pass 1)
                    // ==========================================
                    let candidates = new Set();

                    function addCandidate(src) {
                        if (!src) return;
                        try {
                            let absoluteUrl = src;
                            if (!src.startsWith('http')) {
                                const domain = new URL(url).origin;
                                absoluteUrl = `${domain}${src.startsWith('/') ? '' : '/'}${src}`;
                            }
                            candidates.add(absoluteUrl);
                        } catch(e) {}
                    }

                    // 1. Grab Meta Images
                    let ogImage = $('meta[property="og:image"]').attr('content');
                    if (ogImage && !ogImage.toLowerCase().includes('logo')) addCandidate(ogImage);

                    let twitterImage = $('meta[name="twitter:image"]').attr('content');
                    if (twitterImage && !twitterImage.toLowerCase().includes('logo')) addCandidate(twitterImage);

                    // 2. Grab DOM Images
                    const images = $('img');
                    for (let i = 0; i < images.length; i++) {
                        const imgEl = $(images[i]);
                        let src = imgEl.attr('src') || '';
                        const srcLower = src.toLowerCase();
                        const classNames = (imgEl.attr('class') || '').toLowerCase();
                        const altText = (imgEl.attr('alt') || '').toLowerCase();
                        
                        // 🛑 RUTHLESS JUNK FILTER
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

                        const isThumbnail = /-\d{2,3}x\d{2,3}\./.test(srcLower) || srcLower.includes('thumb');

                        if (!src || isJunk || isThumbnail) continue;
                        if (!srcLower.match(/\.(jpg|jpeg|png|webp)(\?.*)?$/)) continue;

                        let finalImageSrc = src;
                        let resolvedWidth = 0;

                        // Check Webflow Responsive Srcset
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

                        // Check HTML Width
                        if (resolvedWidth === 0) {
                            const rawWidth = imgEl.attr('width');
                            if (rawWidth) resolvedWidth = parseInt(rawWidth, 10) || 0;
                        }

                        // Minimum Size Check (Must be relatively large)
                        if (resolvedWidth > 0 && resolvedWidth < 600) {
                            continue; 
                        }

                        addCandidate(finalImageSrc);
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

                    // Save raw data with all image candidates
                    rawPages.push({
                        title: title.trim(),
                        url: url, 
                        description: (description || '').trim(),
                        candidates: Array.from(candidates), 
                        category: category,
                        priority: priority
                    });
                    
                    console.log(`✅ Scraped: ${url}`);
                } catch (err) {
                    console.error(`❌ Error scraping ${url}`);
                }
            }

            // ==========================================
            // 🧹 PASS 2: THE GLOBAL FREQUENCY FILTER
            // ==========================================
            console.log(`\n🧹 Running Frequency Filter to destroy global spam images...`);
            
            const imageFrequency = {};
            
            // Count how many times every image appears across the ENTIRE site
            rawPages.forEach(page => {
                page.candidates.forEach(img => {
                    imageFrequency[img] = (imageFrequency[img] || 0) + 1;
                });
            });

            // Assign the final image
            const searchIndex = rawPages.map(page => {
                let finalImage = "";
                
                for (const img of page.candidates) {
                    // 🚨 If an image appears on more than 4 pages, it is a global template banner! REJECT IT!
                    if (imageFrequency[img] <= 4) {
                        finalImage = img;
                        break; // We found the unique image for this page!
                    }
                }

                return {
                    title: page.title,
                    url: page.url,
                    description: page.description,
                    image: finalImage,
                    category: page.category,
                    priority: page.priority
                };
            });

            fs.writeFileSync(`${site.name}-index.json`, JSON.stringify(searchIndex, null, 2));
            console.log(`🎉 Saved ${site.name}-index.json!`);

        } catch (error) {
            console.error(`Failed to process sitemap for ${site.name}:`, error.message);
        }
    }
}

scrapeSites();
