export const RET_MAP_KEY = "FLORA_RETRACTION_LOOKUP"
const SOURCE_URL = 'https://gitlab.com/crossref/retraction-watch-data/-/raw/main/retraction_watch.csv?ref_type=heads'

export async function getRetractionMap() {
    try {
        const response = await fetch(SOURCE_URL);
        const csvText = await response.text();
        const rows = csvText.split(/\r?\n/).filter(row => row.trim());
        const csvRegex = /,(?=(?:(?:[^"]*"){2})*[^"]*$)/;
        const headers = rows[0].split(csvRegex);
        const originalIndex = headers.indexOf('OriginalPaperDOI');
        const retractionIndex = headers.indexOf('RetractionDOI');
        const retractionData = {};
        for (let i = 1; i < rows.length; i++) {
            const columns = rows[i].split(csvRegex);
            let originalDOI = columns[originalIndex]?.replace(/^"|"$/g, '').trim();
            let retractionDOI = columns[retractionIndex]?.replace(/^"|"$/g, '').trim();
            if (originalDOI && retractionDOI) {
                // @ts-ignore
                retractionData[originalDOI] = retractionDOI;
            }
        }
        return retractionData;
    } catch (error) {
        console.error("Error fetching or processing CSV:", error);
    }
}

export async function storageSync() {
    let map = await getRetractionMap();
    console.log('map', map)
    if (!map) return;
    await chrome.storage.local.set({[RET_MAP_KEY]: map});
}



