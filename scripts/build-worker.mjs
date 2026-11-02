import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf'};
const assets={};
for(const file of await readdir('dist',{recursive:true})){const ext='.'+file.split('.').at(-1);if(types[ext]&&!file.startsWith('server/')&&!file.startsWith('.openai/'))assets[file]={type:types[ext],data:(await readFile('dist/'+file)).toString('base64')};}
const source=await readFile('worker/index.js','utf8');const worker=source.replace('/* INKLOOP_ASSETS */ {}',JSON.stringify(assets));
await mkdir('dist/server',{recursive:true});await mkdir('dist/.openai',{recursive:true});await writeFile('dist/server/index.js',worker);await writeFile('dist/.openai/hosting.json',await readFile('.openai/hosting.json'));
const module=await import('data:text/javascript;base64,'+Buffer.from(worker).toString('base64'));if(typeof module.default?.fetch!=='function')throw new Error('Invalid worker');
console.log(`Worker verified: ${Object.keys(assets).length} embedded assets, ${(worker.length/1e6).toFixed(2)} MB.`);
