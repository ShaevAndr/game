// Resource-flow sample only: no character decisions and no estimates of duel win rates.
const {createBattlefield,moveBattlefield,findBattlefieldMatches,elements} = require('../src');
let state=27644437;
const rng=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);
function sample(size, count, focus = false) {
 let field=createBattlefield({size},rng), totals=[],direct=[], color=Object.fromEntries(elements.map(e=>[e,[]])), directColors=Object.fromEntries(elements.map(e=>[e,0]));
 let noMatching=0;
 for(let i=0;i<count;i++){
  const board=field.board.map(r=>[...r]),moves=[];
  for(let r=0;r<size;r++)for(let c=0;c<size;c++)for(const [dr,dc]of [[0,1],[1,0]]){
   const rr=r+dr,cc=c+dc;if(rr>=size||cc>=size||board[r][c]===board[rr][cc])continue;
   [board[r][c],board[rr][cc]]=[board[rr][cc],board[r][c]];
   const matched=findBattlefieldMatches(board); const directFire=matched.filter(cell=>board[cell.row][cell.col]==='fire').length; const valid=matched.length>0;
   [board[r][c],board[rr][cc]]=[board[rr][cc],board[r][c]];
   if(valid)moves.push({from:{row:r,col:c},to:{row:rr,col:cc},directFire});
  }
  if(!moves.length){noMatching++;field=createBattlefield({size},rng);i--;continue;}
  const maxFire=focus ? Math.max(...moves.map(m=>m.directFire)) : 0; const candidates=focus ? moves.filter(m=>m.directFire===maxFire) : moves; const move=candidates[Math.floor(rng()*candidates.length)], result=moveBattlefield(field,move.from,move.to,rng);
  const energy=result.direct.count+result.generated.count;
  totals.push(energy);direct.push(result.direct.count);
  for(const e of elements){color[e].push((result.direct.byType[e]||0)+(result.generated.byType[e]||0));if(result.direct.byType[e])directColors[e]++;}
  field={board:result.board,config:result.config};
 }
 const stats=a=>{a.sort((a,b)=>a-b);return {mean:a.reduce((s,x)=>s+x,0)/a.length,median:a[Math.floor(a.length/2)],p90:a[Math.ceil(a.length*.9)-1],p99:a[Math.ceil(a.length*.99)-1],max:a.at(-1)}};
 return {size,count,policy:focus ? 'maximize direct fire, random ties' : 'random matching swap',totalEnergy:stats(totals),directCells:stats(direct),energyAtLeast:Object.fromEntries([20,30,40,60,80,120].map(c=>[c,totals.filter(x=>x>=c).length/count])),colorEnergy:Object.fromEntries(elements.map(e=>[e,stats(color[e])])),directChance:Object.fromEntries(elements.map(e=>[e,directColors[e]/count])),noMatching};
}
process.stdout.write(JSON.stringify({method:'Sequential settled boards, random matching swap among all visible matching swaps, six tile types, seeded RNG. All direct and generated cells give one energy, including defense. No character stats or skill decisions.',seed:27644437,samples:[sample(8,10000),sample(12,2000)]},null,2));
