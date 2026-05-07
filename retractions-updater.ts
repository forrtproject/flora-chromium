// @ts-ignore
import {getRetractionMap} from "./src/shared/data-extract.ts"
// @ts-ignore
import fs from 'node:fs';

const FS_OUTPUT_PATH = './src/retractions.json';

getRetractionMap().then(map => {
    if (map) fs.writeFile(
        FS_OUTPUT_PATH, JSON.stringify(map, null, 2),
        console.error);
    else console.error('read error');
});

