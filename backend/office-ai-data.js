'use strict';
const DATA_ANALYSIS_CODE=`
let rows;
if(input.format==='json')rows=JSON.parse(input.data,(_key,value)=>{if(typeof value==='number'&&!Number.isFinite(value))throw Error('Input values exceed the supported finite number range. Rescale the values; no numeric result was returned.');return value;});
else{
 const records=[];let record=[],field='',quoted=false;
 for(let i=0;i<input.data.length;i++){
  const c=input.data[i];
  if(quoted){if(c==='"'&&input.data[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;}
  else if(c==='"'&&!field)quoted=true;
  else if(c===','){record.push(field);field='';}
  else if(c==='\\n'||c==='\\r'){if(c==='\\r'&&input.data[i+1]==='\\n')i++;record.push(field);if(record.some(v=>v!==''))records.push(record);record=[];field='';}
  else field+=c;
 }
 if(quoted)throw Error('The CSV has an unclosed quoted field.');
 if(field||record.length){record.push(field);records.push(record);}
 const headers=records.shift()||[];
 if(new Set(headers).size!==headers.length||headers.some(h=>!h||['__proto__','constructor','prototype'].includes(h)))throw Error('Use unique, non-empty column names.');
 if(records.some(record=>record.length!==headers.length))throw Error('CSV rows must have the same number of fields as the header.');
 rows=records.map(record=>Object.fromEntries(headers.map((name,i)=>[name,record[i]])));
}
if(!Array.isArray(rows)||rows.length>2000||rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw Error('Provide a table of up to 2,000 object records.');
const columns=[...new Set(rows.flatMap(Object.keys))];if(columns.length>40)throw Error('Use up to 40 columns.');
const missing=v=>v===null||v===undefined||v==='';
const valueAt=(row,name)=>Object.hasOwn(row,name)?row[name]:undefined;
const statistics=Object.fromEntries(columns.map(name=>{
 const values=rows.map(row=>valueAt(row,name)),present=values.filter(v=>!missing(v));
 const numbers=present.map(v=>typeof v==='number'?v:typeof v==='string'&&v.trim()?Number(v):NaN);
 if(numbers.length&&numbers.every(value=>!Number.isNaN(value))&&numbers.some(value=>!Number.isFinite(value)))throw Error('Input values exceed the supported finite number range. Rescale the values; no numeric result was returned.');
 if(numbers.length&&numbers.every(Number.isFinite)){
  const total=numbers.reduce((a,b)=>a+b,0),mean=total/numbers.length,sorted=[...numbers].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);
  const numeric={type:'numeric',count:numbers.length,missing:values.length-present.length,sum:total,min:sorted[0],max:sorted.at(-1),mean,median:sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2,standardDeviation:Math.sqrt(numbers.reduce((a,b)=>a+(b-mean)**2,0)/numbers.length)};
  if(Object.values(numeric).some(value=>typeof value==='number'&&!Number.isFinite(value)))throw Error('Numeric statistics exceed the supported finite number range. Rescale the values or analyze smaller groups; no numeric result was returned.');
  return[name,numeric];
 }
 const counts=new Map();for(const value of present){const label=String(value);counts.set(label,(counts.get(label)||0)+1);}
 return[name,{type:'categorical',count:present.length,missing:values.length-present.length,distinct:counts.size,top:[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([value,count])=>({value,count}))}];
}));
let groups,groupCoverage;
if(input.groupBy){if(!columns.includes(input.groupBy))throw Error('The grouping column does not exist.');const map=new Map();for(const row of rows){const key=String(valueAt(row,input.groupBy)??'');map.set(key,(map.get(key)||0)+1);}groups=[...map].slice(0,100).map(([value,count])=>({value,count}));const returnedRows=groups.reduce((total,group)=>total+group.count,0);groupCoverage={column:input.groupBy,inputRows:rows.length,totalGroups:map.size,returnedGroups:groups.length,omittedGroups:map.size-groups.length,returnedRows,omittedRows:rows.length-returnedRows,truncated:map.size>groups.length};}
return{rowCount:rows.length,columns,statistics,...(groups?{groups,groupCoverage}:{}),sample:rows.slice(0,3)};`;
function createDataTool(runtime){return{permission:'read',retrySafe:true,
  description:'Analyze a CSV or JSON table using actual Cloudflare code execution. Returns row counts, missing values, finite numeric statistics, categorical counts, and optional first-100 grouping with explicit total and omitted group/row coverage. For complete large grouped exports use code_execute and save the result with workspace_write. Calculations are executed rather than guessed.',
  parameters:{type:'object',properties:{data:{type:'string',maxLength:64000},format:{type:'string',enum:['csv','json']},groupBy:{type:'string',maxLength:80}},required:['data','format'],additionalProperties:false},
  execute:(args,context)=>runtime.execute({code:DATA_ANALYSIS_CODE,input:args},context)};}
module.exports={createDataTool,DATA_ANALYSIS_CODE};
