#!/usr/bin/env node
/** Read-only inventory of text candidates. Hits require a UI/data-flow review. */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const rows = [], files = [];
const skip = new Set(['node_modules', '.next', 'dist', 'build', 'coverage', '.turbo', '.git', 'generated', '__tests__', '__mocks__', 'tests', 'scripts', 'locales', '(dev)']);
function walk(dir) {
  for (const e of fs.readdirSync(dir, {withFileTypes:true})) {
    const p=path.join(dir,e.name);
    if(e.isDirectory()) { if(!skip.has(e.name)) walk(p); }
    else if (/\.[cm]?[jt]sx?$/.test(e.name) && !/\.(test|spec|stories|d)\.[cm]?[jt]sx?$/.test(e.name)) files.push(p);
  }
}
walk(path.join(root,'frontend/web/app'));
for(const d of ['components','lib','hooks']) if(fs.existsSync(path.join(root,'frontend/web',d))) walk(path.join(root,'frontend/web',d));
for(const d of fs.readdirSync(path.join(root,'frontend/packages'))) {
  const p=path.join(root,'frontend/packages',d,'src');
  if(d!=='i18n' && fs.existsSync(p)) walk(p);
}
for(const d of ['app','components','lib','hooks']) if(fs.existsSync(path.join(root,'frontend/mobile',d))) walk(path.join(root,'frontend/mobile',d));
const en = JSON.parse(fs.readFileSync(path.join(root,'frontend/packages/i18n/src/locales/en.json'),'utf8'));
const values = new Map();
function flat(obj,p='') { for(const [k,v] of Object.entries(obj)) { const key=p?`${p}.${k}`:k; if(typeof v==='string') { const n=v.replace(/\s+/g,' ').trim(); values.set(n,[...(values.get(n)||[]),key]); } else if(v&&typeof v==='object'&&!Array.isArray(v)) flat(v,key); } }
flat(en);
const attrs = /^(title|subtitle|label|placeholder|aria-label|aria-description|alt|description|emptyText|emptyMessage|emptyTitle|emptyDescription|loadingText|helperText|errorMessage|buttonText|submitLabel|cancelLabel|confirmLabel|createLabel|searchPlaceholder|accessibilityLabel|accessibilityHint|header|text|message|caption|tooltip)$/;
const props = /^(title|subtitle|label|description|placeholder|helperText|emptyText|emptyMessage|emptyTitle|emptyDescription|loadingText|errorMessage|buttonText|submitLabel|cancelLabel|confirmLabel|createLabel|searchPlaceholder|header|headerName|text|message|caption|tooltip)$/;
function textlike(v) { return /[A-Za-zÀ-ÿ]{2}/.test(v) && !/^(https?:|\/|[\w@.-]+@[\w.-]+\.[a-z]+$)/.test(v) && !/^[a-z0-9_-]+\.[a-z0-9_.-]+$/.test(v); }
for(const file of files) {
 const src=fs.readFileSync(file,'utf8');
 const sf=ts.createSourceFile(file,src,ts.ScriptTarget.Latest,true,file.endsWith('x')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 const rel=path.relative(root,file).replaceAll('\\','/');
 const area=rel.startsWith('frontend/web/app/(modules)/') ? 'Web: '+rel.split('/')[4] : rel.startsWith('frontend/packages/') ? 'Package: '+rel.split('/')[2] : rel.startsWith('frontend/mobile/')?'Mobile':rel.startsWith('frontend/web/app/api/')?'Web API':'Web: shared/shell/auth';
 const seen=new Set();
 function translated(n) {
   for(let p=n.parent;p;p=p.parent) {
     if(ts.isCallExpression(p) && /(?:^|\.)(t|translate)$/.test(p.expression.getText(sf))) return true;
     if(ts.isJsxElement(p) && /^(Trans|Translation)$/.test(p.openingElement.tagName.getText(sf))) return true;
     if(ts.isStatement(p)) break;
   } return false;
 }
 function add(n,kind,v,confidence='Direct UI') {
   v=v.replace(/\s+/g,' ').trim();
   if(!textlike(v)||translated(n)) return;
   const id=n.pos+':'+kind; if(seen.has(id))return;seen.add(id);
   const loc=sf.getLineAndCharacterOfPosition(n.getStart(sf));
   rows.push({area,file:rel,line:loc.line+1,column:loc.character+1,kind,confidence,text:v,existingKeys:(values.get(v)||[]).join(' | '),source:src.split(/\r?\n/)[loc.line].trim().slice(0,450)});
 }
 function visibleExpr(n) {
   if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)) add(n,'JSX expression',n.text);
   else if(ts.isTemplateExpression(n)) {
     const segments=[n.head.text,...n.templateSpans.map(s=>s.literal.text)];
     if(segments.some(textlike)) add(n,'JSX template',segments.join('{{value}}'));
     for(const s of n.templateSpans) visibleExpr(s.expression);
   }
   else if(ts.isConditionalExpression(n)) {visibleExpr(n.whenTrue);visibleExpr(n.whenFalse);}
   else if(ts.isBinaryExpression(n)) { if(n.operatorToken.kind===ts.SyntaxKind.PlusToken) {visibleExpr(n.left);visibleExpr(n.right);} else visibleExpr(n.right); }
   else if(ts.isParenthesizedExpression(n)) visibleExpr(n.expression);
 }
 function visit(n) {
   if(ts.isJsxText(n)) add(n,'JSX text',n.text);
   if(ts.isJsxAttribute(n)&&attrs.test(n.name.getText(sf))&&n.initializer) {
     if(ts.isStringLiteral(n.initializer)) add(n.initializer,'UI attribute: '+n.name.getText(sf),n.initializer.text);
     else if(ts.isJsxExpression(n.initializer)&&n.initializer.expression) visibleExpr(n.initializer.expression);
   }
   if(ts.isJsxExpression(n)&&n.expression&&!ts.isJsxAttribute(n.parent)) visibleExpr(n.expression);
   if(ts.isPropertyAssignment(n)&&props.test(n.name.getText(sf).replace(/["']/g,''))) {
     const v=n.initializer;
     if(ts.isStringLiteral(v)||ts.isNoSubstitutionTemplateLiteral(v)) add(v,'Text property: '+n.name.getText(sf),v.text,'Review data flow');
   }
   if(ts.isCallExpression(n)) {
     const name=n.expression.getText(sf);
     if(/(?:^|\.)(?:toast|success|error|warning|info|alert|confirm|setError|setMessage|setStatusMessage)$/.test(name)&&!/^console\./.test(name)) {
       for(const a of n.arguments) if(ts.isStringLiteral(a)||ts.isNoSubstitutionTemplateLiteral(a)||ts.isTemplateExpression(a)) add(a,'Message call: '+name,ts.isTemplateExpression(a)?a.getText(sf).slice(1,-1):a.text,'Review data flow');
     }
     if(/(?:^|\.)(?:min|max|email|url|regex|refine|nonempty)$/.test(name)) {
       for(const a of n.arguments) if(ts.isStringLiteral(a)) add(a,'Validation message',a.text,'Review data flow');
     }
   }
   ts.forEachChild(n,visit);
 }
 visit(sf);
}
rows.sort((a,b)=>a.file.localeCompare(b.file)||a.line-b.line||a.column-b.column);
const groups={};
for(const r of rows) { const g=groups[r.area]??={count:0,direct:0,candidates:0,files:new Set(),reusable:0};g.count++;g[r.confidence==='Direct UI'?'direct':'candidates']++;g.files.add(r.file);if(r.existingKeys)g.reusable++; }
for(const g of Object.values(groups)) g.files=g.files.size;
const summary={source:'working tree',filesScanned:files.length,filesWithMatches:new Set(rows.map(r=>r.file)).size,occurrences:rows.length,direct:rows.filter(r=>r.confidence==='Direct UI').length,candidates:rows.filter(r=>r.confidence!=='Direct UI').length,exactEnglishReuse:rows.filter(r=>r.existingKeys).length,groups:Object.fromEntries(Object.entries(groups).sort((a,b)=>b[1].count-a[1].count)),topFiles:Object.entries(rows.reduce((a,r)=>(a[r.file]=(a[r.file]||0)+1,a),{})).sort((a,b)=>b[1]-a[1]).slice(0,40)};
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ summary, rows }, null, 2))
} else {
  console.log(`UI text audit: ${summary.filesScanned} files; ${summary.direct} direct and ${summary.candidates} data-flow candidates in ${summary.filesWithMatches} files.`)
  console.log("Candidates include intentional names, codes, examples, and stored content; review before changing them.")
  for (const [area, count] of Object.entries(summary.groups)) {
    console.log(`${area}: ${count.direct} direct, ${count.candidates} data-flow candidates (${count.files} files)`)
  }
  console.log("Use --json for source locations, text, and exact English catalog matches.")
}
