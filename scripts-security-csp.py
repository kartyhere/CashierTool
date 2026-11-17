from pathlib import Path
import re,hashlib,base64
for p in Path('src').rglob('*.html'):
 s=p.read_text()
 hashes=[]
 for m in re.finditer(r'<script\b([^>]*)>([\s\S]*?)</script>',s,re.I):
  if 'src=' not in m.group(1) and m.group(2).strip():hashes.append("'sha256-"+base64.b64encode(hashlib.sha256(m.group(2).encode()).digest()).decode()+"'")
 csp="default-src 'none'; script-src 'self' "+' '.join(hashes)+"; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; worker-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';"
 s=re.sub(r'<meta\s+http-equiv="Content-Security-Policy"[^>]*>', '',s,flags=re.I)
 s=s.replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="'+csp+'">',1)
 p.write_text(s)
