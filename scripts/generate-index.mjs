import {loadEditions, root} from './editions.mjs';
import {writeModules} from './package-api.mjs';

await writeModules(root, await loadEditions());
