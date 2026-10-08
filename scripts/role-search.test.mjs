import test from 'node:test';
import assert from 'node:assert/strict';
import {searchRoleOptions,normalizeRoleSearch} from '../web/src/utils/roleSearch.mjs';
const roles=[{value:'Software Engineer',desc:'Build software'},{value:'Registered Nurse',desc:'Patient care'},{value:'Product Manager',desc:'Plan products'},{value:'UX Designer',desc:'Design interfaces'},{value:'AI Engineer',desc:'Build models'}];
test('role search supports abbreviations, reordered words, prefixes and small typos',()=>{
 for(const [query,value] of [['SWE','Software Engineer'],['RN','Registered Nurse'],['PM','Product Manager'],['engineer software','Software Engineer'],['software enginer','Software Engineer'],['ux','UX Designer'],['ai','AI Engineer']])assert.equal(searchRoleOptions(roles,query)[0]?.value,value,query);
 assert.deepEqual(searchRoleOptions(roles,'nurse software'),[]);
 assert.equal(searchRoleOptions(roles,'').length,roles.length);
});
test('technical role names preserve their language meaning and ignore punctuation',()=>{
 assert.equal(normalizeRoleSearch('C++ / C# .NET'),'cplusplus csharp dotnet');
 assert.equal(searchRoleOptions(['C++ Developer','C# Developer'], 'C++')[0],'C++ Developer');
 assert.equal(searchRoleOptions(['Front-End Developer','Backend Developer'],'front end')[0],'Front-End Developer');
});
test('topic search matches aliases, reordered words and a single missing character',()=>{
 const topics=['AI & Machine Learning','Cybersecurity','Career Growth','Travel & Adventure'];
 assert.equal(searchRoleOptions(topics,'cybersecurty')[0],'Cybersecurity');
 assert.equal(searchRoleOptions(topics,'learning machine')[0],'AI & Machine Learning');
 assert.equal(searchRoleOptions(topics,'artificial intelligence')[0],'AI & Machine Learning');
 assert.equal(searchRoleOptions(topics,'TRAVEL')[0],'Travel & Adventure');
 assert.deepEqual(searchRoleOptions(topics,'travel cybersecurity'),[]);
});
