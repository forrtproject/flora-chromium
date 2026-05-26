import fs from 'node:fs';
import type {RetractionMaps} from './src/shared/data-extract.ts';

const SOURCE_URL =
    'https://gitlab.com/crossref/retraction-watch-data/-/raw/main/retraction_watch.csv?ref_type=heads';
const FS_OUTPUT_PATH = './src/retractions.json';

// RetractionNature values that describe a paper's status. "Correction" is
// deliberately excluded: a corrected paper still stands. Blank values are
// notices we can't classify.
const RETRACTION = 'Retraction';
const CONCERN = 'Expression of concern';
const REINSTATEMENT = 'Reinstatement';
const STATUS_NATURES = new Set([RETRACTION, CONCERN, REINSTATEMENT]);

// Tie-break when two status events for the same paper share a date (vanishingly
// rare). Surface the more consequential notice.
const NATURE_RANK: Record<string, number> = {
    [RETRACTION]: 3,
    [REINSTATEMENT]: 2,
    [CONCERN]: 1,
};

interface StatusEvent {
    nature: string;
    time: number;
    notice: string;
}

/** Minimal RFC-4180 CSV parser: handles quoted fields, "" escapes, CRLF. */
function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let field = '';
    let row: string[] = [];
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else field += c;
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ',') {
            row.push(field); field = '';
        } else if (c === '\n') {
            row.push(field); rows.push(row); row = []; field = '';
        } else if (c !== '\r') {
            field += c;
        }
    }
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    return rows;
}

/** Retraction Watch dates look like "8/1/2020 0:00"; returns epoch ms. */
function parseDate(s: string): number {
    const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
    if (!m) return Number.NEGATIVE_INFINITY;
    return Date.UTC(+m[3], +m[1] - 1, +m[2], +m[4], +m[5]);
}

function clean(s: string | undefined): string {
    return (s ?? '').replace(/^"|"$/g, '').trim();
}

function isRealDoi(doi: string): boolean {
    return doi !== '' && doi.toLowerCase() !== 'unavailable';
}

export async function getRetractionMap(): Promise<RetractionMaps | undefined> {
    let csvText: string;
    try {
        const response = await fetch(SOURCE_URL);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        csvText = await response.text();
    } catch (error) {
        console.error('Error fetching CSV:', error);
        return;
    }

    const rows = parseCsv(csvText);
    const headers = rows[0];
    const natureIdx = headers.indexOf('RetractionNature');
    const dateIdx = headers.indexOf('RetractionDate');
    const noticeIdx = headers.indexOf('RetractionDOI');
    const originalIdx = headers.indexOf('OriginalPaperDOI');
    if ([natureIdx, dateIdx, noticeIdx, originalIdx].some(i => i < 0)) {
        console.error('CSV is missing an expected column.');
        return;
    }

    // Collect every status event per original paper.
    const byDoi = new Map<string, StatusEvent[]>();
    for (let i = 1; i < rows.length; i++) {
        const cols = rows[i];
        const nature = clean(cols[natureIdx]);
        if (!STATUS_NATURES.has(nature)) continue;
        const originalDOI = clean(cols[originalIdx]);
        if (!isRealDoi(originalDOI)) continue;
        const event: StatusEvent = {
            nature,
            time: parseDate(cols[dateIdx]),
            notice: clean(cols[noticeIdx]),
        };
        const list = byDoi.get(originalDOI);
        if (list) list.push(event);
        else byDoi.set(originalDOI, [event]);
    }

    // For each paper, the latest status event wins. A later retraction beats an
    // earlier reinstatement (and vice versa); corrections never count.
    const retractions: Record<string, string> = {};
    const concerns: Record<string, string> = {};
    for (const [originalDOI, events] of byDoi) {
        const latest = events.reduce((a, b) =>
            b.time > a.time || (b.time === a.time && NATURE_RANK[b.nature] > NATURE_RANK[a.nature])
                ? b : a);
        if (latest.nature === REINSTATEMENT) continue; // reinstated -> not flagged

        // Pick the notice link from the winning nature's events: prefer a real
        // DOI, then the most recent.
        const same = events.filter(e => e.nature === latest.nature);
        const real = same.filter(e => isRealDoi(e.notice));
        const pick = (real.length ? real : same).reduce((a, b) => b.time > a.time ? b : a);
        if (!pick.notice) continue; // no linkable notice at all -> skip

        if (latest.nature === RETRACTION) retractions[originalDOI] = pick.notice;
        else concerns[originalDOI] = pick.notice; // CONCERN
    }

    console.error(
        `Parsed ${rows.length - 1} rows -> ${Object.keys(retractions).length} retractions, ` +
        `${Object.keys(concerns).length} expressions of concern.`);
    return {retractions, concerns};
}

getRetractionMap().then(map => {
    if (map) fs.writeFile(FS_OUTPUT_PATH, JSON.stringify(map, null, 2), console.error);
    else { console.error('read error'); process.exitCode = 1; }
});
