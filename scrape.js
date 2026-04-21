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
                    // 📸 MULTI-SOURCE IMAGE EXTRACTOR
                    // ==========================================
                    let candidates = new Set();

                    // Centralized formatting for all extracted URLs
                    function addCandidate(src) {
                        if (!src) return;
                        // Clean up CSS url() formatting (quotes and entities)
                        let cleanSrc = src.replace(/&quot;/g, '').replace(/^['"]|['"]$/g, '').trim();
                        
                        try {
                            if (!cleanSrc.startsWith('http') && !cleanSrc.startsWith('//')) {
                                if (cleanSrc.startsWith('data:')) return; // Ignore base64
                                const domain = new URL(url).origin;
                                cleanSrc = `${domain}${cleanSrc.startsWith('/') ? '' : '/'}${cleanSrc}`;
                            } else if (cleanSrc.startsWith('//')) {
                                cleanSrc = `https:${cleanSrc}`;
                            }
                            candidates.add(cleanSrc);
                        } catch(e) {}
                    }

                    // Centralized strict junk filter
                    function isValidImage(src, classNames = '', altText = '') {
                        if (!src) return false;
                        const srcLower = src.toLowerCase();

                        // Must be a standard photo format (Reject fonts/svgs)
                        if (!srcLower.match(/\.(jpg|jpeg|png|webp)(\?.*)?$/)) return false;

                        const isJunk = srcLower.includes('logo') || classNames.includes('logo') || altText.includes('logo') ||
                                       srcLower.includes('icon') || classNames.includes('icon') || altText.includes('icon') ||
                                       srcLower.includes('avatar') || classNames.includes('avatar') || altText.includes('avatar') ||
                                       srcLower.includes('close') || classNames.includes('close') ||
                                       srcLower.includes('arrow') || classNames.includes('arrow') ||
                                       srcLower.includes('placeholder') ||
                                       classNames.includes('nav') || classNames.includes('footer');

                        const isThumbnail = /-\d{2,3}x\d{2,3}\./.test(srcLower) || srcLower.includes('thumb');

                        return !(isJunk || isThumbnail);
                    }

                    // --- PRIORITY 1: Meta Images ---
                    let ogImage = $('meta[property="og:image"]').attr('content');
                    if (isValidImage(ogImage)) addCandidate(ogImage);

                    let twitterImage = $('meta[name="twitter:image"]').attr('content');
                    if (isValidImage(twitterImage)) addCandidate(twitterImage);

                    // --- PRIORITY 2: Inline CSS Backgrounds (Webflow CMS Heros) ---
                    $('[style*="background"]').each((i, el) => {
                        const style = $(el).attr('style');
                        const classNames = ($(el).attr('class') || '').toLowerCase();
                        
                        // Extracts inside of url() 
                        const match = style.match(/url\((.*?)\)/i);
                        if (match && match[1]) {
                            let src = match[1];
                            if (isValidImage(src, classNames)) {
                                addCandidate(src);
                            }
                        }
                    });

                    // --- PRIORITY 3: Standard IMG Tags ---
                    const images = $('img');
                    for (let i = 0; i < images.length; i++) {
                        const imgEl = $(images[i]);
                        const src = imgEl.attr('src') || '';
                        const classNames = (imgEl.attr('class') || '').toLowerCase();
                        const altText = (imgEl.attr('alt') || '').toLowerCase();
                        
                        if (!isValidImage(src, classNames, altText)) continue;

                        let finalImageSrc = src;
                        let resolvedWidth = 0;

                        // Check Webflow Responsive Srcset for largest size
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

                        if (resolvedWidth === 0) {
                            const rawWidth = imgEl.attr('width');
                            if (rawWidth) resolvedWidth = parseInt(rawWidth, 10) || 0;
                        }

                        if (resolvedWidth > 0 && resolvedWidth < 600) continue; 

                        addCandidate(finalImageSrc);
                    }

                    // --- PRIORITY 4: Internal Style Blocks (CSS Backgrounds) ---
                    $('style').each((i, el) => {
                        const cssText = $(el).html();
                        if (cssText) {
                            // Find all URLs in the CSS block
                            const matches = cssText.matchAll(/url\((.*?)\)/gi);
                            for (const match of matches) {
                                if (match[1] && isValidImage(match[1])) {
                                    addCandidate(match[1]);
                                }
                            }
                        }
                    });
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
            
            rawPages.forEach(page => {
                page.candidates.forEach(img => {
                    imageFrequency[img] = (imageFrequency[img] || 0) + 1;
                });
            });

            const searchIndex = rawPages.map(page => {
                let finalImage = "";
                
                for (const img of page.candidates) {
                    // 🚨 Reject templates: If it appears on > 4 pages, kill it!
                    if (imageFrequency[img] <= 4) {
                        finalImage = img;
                        break; 
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
