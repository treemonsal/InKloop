import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const files=(await readdir('dist',{recursive:true})).filter(p=>/\.(js|css|png|svg|webmanifest|woff2)$/.test(p)&&p!=='sw.js').sort();
const hash=createHash('sha256');for(const file of files)hash.update(await readFile('dist/'+file));hash.update(await readFile('dist/index.html'));
let sw=await readFile('public/sw.js','utf8');sw=sw.replace("const CACHE='inkloop-shell-v1';",`const CACHE='inkloop-shell-${hash.digest('hex').slice(0,12)}';`);
sw=sw.replace("[ROOT,new URL('manifest.webmanifest',ROOT).href,new URL('icon.svg',ROOT).href]",`[ROOT,...${JSON.stringify(files)}.map(path=>new URL(path,ROOT).href)]`);
await writeFile('dist/sw.js',sw);
console.log(`Offline shell: ${files.length} assets precached.`);
