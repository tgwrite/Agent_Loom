import { arms } from './arms.mjs';
const [name, root] = process.argv.slice(2);
console.log(JSON.stringify(await arms[name].inspect(await arms[name].open(root))));
