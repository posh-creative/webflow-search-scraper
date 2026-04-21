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
            console.log(`Found ${urls.length} URLs for ${site.name}.`);

            // ==========================================
            // 🎨 PRE-SCRAPE: ADVANCED CSS DICTIONARY
            // Extracts all classes that have background images attached in Webflow
            // ==========================================
            console.log(`🎨 Extracting global Webflow CSS for background images...`);
            let classToImage = {};
            try {
                const domain = new URL(site.sitemap).origin;
                const { data: homeHtml } = await axios.get(domain);
                const $home = cheerio.load(homeHtml);
                const cssLinks =[];
                
                $home('link[rel="stylesheet"]').each((i, el) => {
                    const href = $home(el).attr('href');
                    if (href && !href.includes('fonts') && !href.includes('typekit')) {
                        const absoluteHref = href.startsWith('http') ? href : href.startsWith('//') ? `https:${href}` : `${domain}${href.startsWith('/') ? '' : '/'}${href}`;
                        cssLinks.push(absoluteHref);
                    }
                });

                for (const cssUrl of cssLinks) {
                    try {
                        const { data: cssText } = await axios.get(cssUrl);
                        
                        // Smart Regex that handles minified CSS and Media Queries beautifully
                        const blockRegex = /([^{]+)\{([^}]+)\}/g;
                        let match;
                        while ((match = blockRegex.exec(cssText)) !== null) {
                            const selectors = match[1];
                            const rules = match[2];
                            const urlMatch = rules.match(/url\(['"]?(.*?)['"]?\)/i);
                            
                            if (urlMatch && urlMatch[1]) {
                                let imgUrl = urlMatch[1].replace(/&quot;/g, '').replace(/^['"]|['"]$/g, '').trim();
                                
                                // Extract every class name from the selector block
                                const classMatches = selectors.match(/\.([a-zA-Z0-9_-]+)/g);
                                if (classMatches) {
                                    classMatches.forEach(cls => {
                                        const cleanClass = cls.substring(1);
                                        classToImage[cleanClass] = imgUrl; // Map the class to the image!
                                    });
                                }
                            }
                        }
                    } catch(e) { }
                }
                console.log(`✅ Dictionary built! Found ${Object.keys(classToImage).length} classes with background images.`);
            } catch(err) {
                console.log(`⚠️ Could not extract global CSS: ${err.message}`);
            }

            console.log(`Scraping pages...`);

            for (const url of urls) {
                try {
                    const { data: html } = await axios.get(url);
                    const $ = cheerio.load(html);

                    const title = $('title').text() || $('h1').first().text();
                    
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
                    // 📸 PRIORITY IMAGE EXTRACTOR
                    // ==========================================
                    let candidates = new Set();

                    function addCandidate(src) {
                        if (!src) return;
                        let cleanSrc = src.replace(/&quot;/g, '').replace(/^['"]|['"]$/g, '').trim();
                        
                        try {
                            if (!cleanSrc.startsWith('http') && !cleanSrc.startsWith('//')) {
                                if (cleanSrc.startsWith('data:')) return; 
                                const domain = new URL(url).origin;
                                cleanSrc = `${domain}${cleanSrc.startsWith('/') ? '' : '/'}${cleanSrc}`;
                            } else if (cleanSrc.startsWith('//')) {
                                cleanSrc = `https:${cleanSrc}`;
                            }
                            candidates.add(cleanSrc);
                        } catch(e) {}
                    }

                    function isValidImage(src, classNames = '', altText = '') {
                        if (!src) return false;
                        const srcLower = src.toLowerCase();

                        if (!srcLower.match(/\.(jpg|jpeg|png|webp)(\?.*)?$/)) return false;

                        const isJunk = srcLower.includes('logo') || classNames.includes('logo') || altText.includes('logo') ||
                                       srcLower.includes('icon') || classNames.includes('icon') || altText.includes('icon') ||
                                       srcLower.includes('avatar') || classNames.includes('avatar') || altText.includes('avatar') ||
                                       srcLower.includes('close') || classNames.includes('close') ||
                                       srcLower.includes('arrow') || classNames.includes('arrow') ||
                                       classNames.includes('nav') || classNames.includes('footer');

                        const isThumbnail = /-\d{2,3}x\d{2,3}\./.test(srcLower) || srcLower.includes('thumb');

                        return !(isJunk || isThumbnail);
                    }

                    // 1. Meta Images
                    let ogImage = $('meta[property="og:image"]').attr('content');
                    if (isValidImage(ogImage)) addCandidate(ogImage);

                    // 2. Inline CSS Backgrounds
                    $('[style*="background"]').each((i, el) => {
                        const style = $(el).attr('style');
                        const classNames = ($(el).attr('class') || '').toLowerCase();
                        const match = style.match(/url\((.*?)\)/i);
                        if (match && match[1]) {
                            if (isValidImage(match[1], classNames)) addCandidate(match[1]);
                        }
                    });

                    // 3. Webflow CSS Class Backgrounds (The Dictionary Hook)
                    $('[class]').each((i, el) => {
                        const classes = ($(el).attr('class') || '').split(/\s+/);
                        classes.forEach(cls => {
                            if (classToImage[cls]) {
                                if (isValidImage(classToImage[cls], cls)) {
                                    addCandidate(classToImage[cls]);
                                }
                            }
                        });
                    });

                    // 4. Standard Images
                    const images = $('img');
                    for (let i = 0; i < images.length; i++) {
                        const imgEl = $(images[i]);
                        const src = imgEl.attr('src') || '';
                        const classNames = (imgEl.attr('class') || '').toLowerCase();
                        const altText = (imgEl.attr('alt') || '').toLowerCase();
                        
                        if (!isValidImage(src, classNames, altText)) continue;

                        let finalImageSrc = src;
                        let resolvedWidth = 0;

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
                        candidates: Array.from(candidates), // Preserves priority order
                        category: category,
                        priority: priority
                    });
                    
                    console.log(`✅ Scraped: ${url}`);
                } catch (err) {
                    console.error(`❌ Error scraping ${url}`);
                }
            }

            // ==========================================
            // 🧹 PASS 2: SMART FREQUENCY FILTER
            // ==========================================
            console.log(`\n🧹 Running Smart Frequency Filter...`);
            
            const imageFrequency = {};
            
            // Count image appearances
            rawPages.forEach(page => {
                page.candidates.forEach(img => {
                    imageFrequency[img] = (imageFrequency[img] || 0) + 1;
                });
            });

            const searchIndex = rawPages.map(page => {
                let finalImage = "";
                
                // Try to find a unique image first (appears on 8 pages or fewer)
                const uniqueCandidates = page.candidates.filter(img => imageFrequency[img] <= 8);
                
                if (uniqueCandidates.length > 0) {
                    finalImage = uniqueCandidates[0]; 
                } 
                // 🚨 SMART RESCUE: If the page ONLY has generic images (like allianceBlank.jpg), 
                // use the primary generic image rather than leaving the result completely blank!
                else if (page.candidates.length > 0) {
                    finalImage = page.candidates[0]; 
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
