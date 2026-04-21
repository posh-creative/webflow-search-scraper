const axios = require('axios');
const cheerio = require('cheerio');
const xml2js = require('xml2js');
const fs = require('fs');

// Change this for future sites!
const SITEMAP_URL = 'https://www.alliancemedical.co.uk/sitemap.xml'; 

async function scrapeSite() {
    console.log(`Fetching sitemap from ${SITEMAP_URL}...`);
    
    try {
        const { data: sitemapXml } = await axios.get(SITEMAP_URL);
        const parser = new xml2js.Parser();
        const sitemapObj = await parser.parseStringPromise(sitemapXml);

        // Extract all URLs from the XML
        const urls = sitemapObj.urlset.url.map(entry => entry.loc[0]);
        console.log(`Found ${urls.length} URLs. Scraping...`);

        const searchIndex = [];

        for (const url of urls) {
            try {
                const { data: html } = await axios.get(url);
                const $ = cheerio.load(html);

                // Scrape page data
                const title = $('title').text() || $('h1').first().text();
                const description = $('meta[name="description"]').attr('content') || '';

                // --- SMART PRIORITY LOGIC ---
                // Change these keywords for future sites
                let priority = 10;
                let category = "Page";

                if (url.includes('/scan-type/') || url.includes('/diagnostic-services/')) {
                    priority = 100; category = "Service";
                } else if (url.includes('/scanning-centres/') || url.includes('/scan-centres/')) {
                    priority = 80; category = "Location";
                } else if (url.includes('/for-patients/') || url.includes('/for-referrers/')) {
                    priority = 50; category = "Info";
                } else if (url.includes('/news/') || url.includes('/blog/')) {
                    priority = 20; category = "News";
                }

                // Add to array
                searchIndex.push({
                    title: title.trim(),
                    url: url, 
                    description: description.trim(),
                    category: category,
                    priority: priority
                });
                
                console.log(`✅ Scraped: ${url}`);
            } catch (err) {
                console.error(`❌ Error scraping ${url}`);
            }
        }

        // Save the file
        fs.writeFileSync('search-index.json', JSON.stringify(searchIndex, null, 2));
        console.log('🎉 Scraping complete. search-index.json created!');

    } catch (error) {
        console.error('Failed to process sitemap:', error);
    }
}

scrapeSite();