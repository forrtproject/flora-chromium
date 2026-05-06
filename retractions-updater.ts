import {getRetractionMap} from "../src/shared/data-extract.ts"
import fs from 'node:fs';

const FS_OUTPUT_PATH = './src/retractions.json';

(async () => {
    getRetractionMap().then(map => {
        if (map) fs.writeFile(FS_OUTPUT_PATH, JSON.stringify(map, null, 2), err => {
            if (err) {
                console.error(err);
            }
        });
        else {
            console.error('read error');
        }
    });
})()

