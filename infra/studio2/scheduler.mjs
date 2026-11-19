import {getContext,readBrand,runModules,MODULES} from '@pratapai/content-pipeline';

const ctx=await getContext();
try {
  const kit=await readBrand(ctx);
  if (!kit.onboardedAt) {
    console.log(JSON.stringify({status:'waiting_for_setup',message:'Complete Brand setup before automatic research, generation or publishing.'}));
  } else {
    const runs=await runModules(MODULES,ctx);
    console.log(JSON.stringify(runs.map(({moduleId,status,message})=>({moduleId,status,message}))));
    if(runs.some(r=>r.status==='error'))process.exitCode=1;
  }
} finally {
  for(const pool of globalThis.__contentPools?.values()??[])await(await pool).end();
}
