
(function(){
/* ---------- Website adapters: replace the services the Claude version got from claude.ai ---------- */
const CFG=window.IF_CONFIG||{};

/* Accounts (Supabase) + application tracker.
   Signed out: applications are saved in this browser. Signed in: saved to the person's account and synced across devices. */
let acctUser=null;
const SB=(CFG.SUPABASE_URL&&CFG.SUPABASE_ANON_KEY&&window.supabase)?window.supabase.createClient(CFG.SUPABASE_URL,CFG.SUPABASE_ANON_KEY):null;
const Store=(()=>{
  const K='intern-finder-apps';const subs=[];let mode='local',cache={},user=null;
  const loadLocal=()=>{try{return JSON.parse(localStorage.getItem(K)||'{}')}catch(e){return {}}};
  const saveLocal=()=>{try{localStorage.setItem(K,JSON.stringify(cache))}catch(e){const er=new Error('full');er.code='quota_exceeded';throw er}};
  const emit=()=>{const s={docs:Object.entries(cache).map(([id,v])=>({id,data:()=>v}))};subs.forEach(cb=>cb(s))};
  async function persist(id){
    if(mode==='local'){saveLocal();return}
    const r=cache[id]?await SB.from('applications').upsert({user_id:user.id,id,data:cache[id],updated_at:new Date().toISOString()})
                     :await SB.from('applications').delete().eq('user_id',user.id).eq('id',id);
    if(r.error)throw r.error;
  }
  async function change(id,fn){const before=cache[id];fn();try{await persist(id)}catch(e){if(before===undefined)delete cache[id];else cache[id]=before;emit();throw e}emit()}
  window.addEventListener('storage',e=>{if(e.key===K&&mode==='local'){cache=loadLocal();emit()}});
  cache=loadLocal();
  return {
    collection:()=>({
      doc:id=>({
        set:v=>change(id,()=>{cache[id]=v}),
        update:v=>{if(!cache[id])return Promise.reject(new Error('missing'));return change(id,()=>{cache[id]=Object.assign({},cache[id],v)})},
        delete:()=>change(id,()=>{delete cache[id]})}),
      where:()=>({onSnapshot:cb=>{subs.push(cb);cb({docs:Object.entries(cache).map(([id,v])=>({id,data:()=>v}))})}})
    }),
    async useAccount(u){
      user=u;mode='cloud';
      const {data,error}=await SB.from('applications').select('id,data');
      if(error){mode='local';user=null;throw error}
      cache={};(data||[]).forEach(r=>{cache[r.id]=r.data});
      const local=loadLocal(),extra=Object.entries(local).filter(([id])=>!cache[id]);
      if(extra.length){   // move applications tracked before signing in into the account
        const {error:e2}=await SB.from('applications').upsert(extra.map(([id,v])=>({user_id:u.id,id,data:v})));
        if(!e2){extra.forEach(([id,v])=>{cache[id]=v});try{localStorage.removeItem(K)}catch(e){}}
      }
      emit();
    },
    useBrowser(){mode='local';user=null;cache=loadLocal();emit()}
  };
})();

/* Sign-in panel */
(function(){
  const box=document.getElementById('acct');if(!box)return;
  if(!SB){box.hidden=true;return}
  box.hidden=false;
  const btn=document.getElementById('acctBtn'),panel=document.getElementById('acctPanel'),msg=document.getElementById('acctMsg');
  const here=location.origin+location.pathname;
  const show=t=>{msg.textContent=t||''};
  btn.addEventListener('click',()=>{panel.hidden=!panel.hidden;show('')});
  document.addEventListener('click',e=>{if(!panel.hidden&&!box.contains(e.target))panel.hidden=true});
  document.getElementById('acctGoogle').addEventListener('click',async()=>{
    const {error}=await SB.auth.signInWithOAuth({provider:'google',options:{redirectTo:here}});
    if(error)show('Google sign-in is not set up yet. Use your email instead.');
  });
  document.getElementById('acctForm').addEventListener('submit',async e=>{
    e.preventDefault();const em=document.getElementById('acctEmail').value.trim();if(!em)return;
    show('Sending…');
    const {error}=await SB.auth.signInWithOtp({email:em,options:{emailRedirectTo:here}});
    show(error?'Could not send the link: '+error.message:'Check your email for a sign-in link.');
  });
  document.getElementById('acctOut').addEventListener('click',async()=>{await SB.auth.signOut();panel.hidden=true});
  let current;
  async function apply(session){
    const u=session&&session.user;
    const key=u?u.id:'';if(key===current)return;current=key;acctUser=u||null;
    try{INBOX=null;inboxState='idle';if(view==='inbox')renderInbox()}catch(e){}
    document.getElementById('acctIn').hidden=!!u;document.getElementById('acctUser').hidden=!u;
    btn.textContent=u?(u.email||'Account'):'Sign in';
    if(u){document.getElementById('acctWho').textContent=u.email||'';try{await Store.useAccount(u)}catch(e){show('Could not load your saved applications. Try again later.')}}
    else Store.useBrowser();
  }
  SB.auth.getSession().then(({data})=>apply(data.session));
  SB.auth.onAuthStateChange((ev,session)=>{if(ev==='SIGNED_IN'||ev==='SIGNED_OUT')apply(session)});
})();

/* Resume matching: calls this site's /api/match function, which calls Gemini or Claude with your API key. */
const MATCH_API='/api/match';
const b64=f=>new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(String(r.result).split(',')[1]);r.onerror=no;r.readAsDataURL(f)});
const sampleApi={
  limits:async()=>({images:true,pdf:true}),
  json:async(prompt,o={})=>{
    const image=o.images?{type:o.images.type,data:await b64(o.images)}:o.pdf?{type:'application/pdf',data:await b64(o.pdf)}:null;
    let r;
    try{r=await fetch(MATCH_API,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt,image,quick:o.modelTier==='quick'}),signal:o.signal})}
    catch(e){if(e&&e.name==='AbortError')throw{code:'cancelled'};throw{code:'network'}}
    const j=await r.json().catch(()=>({}));
    if(!r.ok)throw{code:r.status===429?'rate_limited':j.error||'refused',detail:j.detail||(r.status===504?'The AI took too long to answer.':'')};
    return j.result;
  }
};

/* Gmail inbox: Google sign-in in the browser, then the Gmail API (read-only). Needs GOOGLE_CLIENT_ID in config.js. */
const GmailApi=(()=>{
  if(!CFG.GOOGLE_CLIENT_ID)return null;
  let token=null,expires=0,client=null,silent=false,server=null;
  const SCOPE='https://www.googleapis.com/auth/gmail.readonly',TK='if-gtok';
  const gsi=new Promise((ok,no)=>{const s=document.createElement('script');s.src='https://accounts.google.com/gsi/client';s.onload=ok;s.onerror=no;document.head.appendChild(s)});
  const who=()=>acctUser?acctUser.id:'anon';
  const blob=()=>(acctUser&&acctUser.user_metadata&&acctUser.user_metadata.gmail_rt)||'';
  function loadTok(){try{const o=JSON.parse(localStorage.getItem(TK)||'null');if(o&&o.u===who()&&o.exp>Date.now()+60000){token=o.t;expires=o.exp}}catch(e){}}
  function saveTok(){try{localStorage.setItem(TK,JSON.stringify({u:who(),t:token,exp:expires}))}catch(e){}}
  function clearTok(){token=null;expires=0;try{localStorage.removeItem(TK)}catch(e){}}
  async function serverOk(){if(server===null){try{const r=await fetch('/api/gmail-token');server=r.ok&&!!(await r.json()).ok}catch(e){server=false}}return server}
  async function tokenApi(body){const r=await fetch('/api/gmail-token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...body,client_id:CFG.GOOGLE_CLIENT_ID})});
    const j=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(j.error||'token');e.code='needs_reauth';throw e}return j}
  async function refreshSilently(){
    if(!blob()||!(await serverOk()))return false;
    try{const j=await tokenApi({action:'refresh',blob:blob()});token=j.access_token;expires=Date.now()+j.expires_in*1000;saveTok();return true}catch(e){return false}
  }
  async function auth(){
    if(!token)loadTok();
    if(token&&Date.now()<expires-60000)return token;
    if(await refreshSilently())return token;
    if(silent){const e=new Error('auth');e.code='needs_reauth';throw e}   // never pop up Google without a tap
    await gsi;
    const hint=linkedGmail()||(acctUser&&acctUser.email)||undefined;
    if(await serverOk()&&SB&&acctUser){   // one-time consent; after this the server keeps you signed in
      return new Promise((ok,no)=>{
        const cc=google.accounts.oauth2.initCodeClient({client_id:CFG.GOOGLE_CLIENT_ID,scope:SCOPE,ux_mode:'popup',hint,
          callback:async r=>{
            if(r.error){const e=new Error(r.error);e.code='needs_reauth';no(e);return}
            try{const j=await tokenApi({action:'exchange',code:r.code});token=j.access_token;expires=Date.now()+j.expires_in*1000;saveTok();
              if(j.blob){const {data}=await SB.auth.updateUser({data:{gmail_rt:j.blob}});if(data&&data.user)acctUser=data.user}
              ok(token);rememberGmail(token)}catch(e){no(e)}},
          error_callback:()=>{const e=new Error('closed');e.code='needs_reauth';no(e)}});
        cc.requestCode();
      });
    }
    return new Promise((ok,no)=>{
      client=client||google.accounts.oauth2.initTokenClient({client_id:CFG.GOOGLE_CLIENT_ID,scope:'https://www.googleapis.com/auth/gmail.readonly',callback:()=>{}});
      client.callback=r=>{if(r.error){const e=new Error(r.error);e.code='needs_reauth';no(e);return}token=r.access_token;expires=Date.now()+r.expires_in*1000;saveTok();ok(token);rememberGmail(token)};
      client.error_callback=()=>{const e=new Error('closed');e.code='needs_reauth';no(e)};
      client.requestAccessToken({prompt:'',hint});
    });
  }
  async function get(path){
    const t=await auth();
    const r=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/'+path,{headers:{Authorization:'Bearer '+t}});
    if(r.status===401){clearTok();if(await refreshSilently())return get(path);const e=new Error('auth');e.code='needs_reauth';throw e}
    if(!r.ok){const e=new Error('Gmail error '+r.status);e.code='tool_error';throw e}
    return r.json();
  }
  const hdr=(m,n)=>((m.payload&&m.payload.headers)||[]).find(h=>h.name.toLowerCase()===n)?.value||'';
  const msg=m=>{const d=hdr(m,'date');let iso='';try{iso=d?new Date(d).toISOString():''}catch(e){}
    return {subject:hdr(m,'subject'),sender:hdr(m,'from'),date:iso,snippet:m.snippet||''}};
  const thread=async id=>{const t=await get(`threads/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`);
    const ms=(t.messages||[]).map(msg);return {id,viewUrl:'https://mail.google.com/mail/u/0/#all/'+id,messageCount:ms.length,messages:ms}};
  async function pool(ids,n,fn){const out=[];let i=0;await Promise.all(Array.from({length:n},async()=>{while(i<ids.length){const k=i++;try{out[k]=await fn(ids[k])}catch(e){if(e.code==='needs_reauth')throw e}}}));return out.filter(Boolean)}
  async function rememberGmail(t){
    try{const r=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile',{headers:{Authorization:'Bearer '+t}});
      const p=await r.json();const em=p.emailAddress;
      if(em&&SB&&acctUser&&linkedGmail()!==em){const {data}=await SB.auth.updateUser({data:{gmail:em}});if(data&&data.user)acctUser=data.user}
    }catch(e){}
  }
  async function disconnect(){
    try{if(token&&window.google)google.accounts.oauth2.revoke(token,()=>{})}catch(e){}
    try{if(blob()&&await serverOk())await tokenApi({action:'revoke',blob:blob()})}catch(e){}
    clearTok();
    if(SB&&acctUser){const {data}=await SB.auth.updateUser({data:{gmail:null,gmail_rt:null}});if(data&&data.user)acctUser=data.user}
  }
  return {
    disconnect,
    canCheckQuietly(){if(!token)loadTok();return (token&&Date.now()<expires-60000)||!!blob()},
    setSilent(v){silent=v},
    async search_threads({query,pageSize}){const r=await get(`threads?q=${encodeURIComponent(query)}&maxResults=${pageSize||30}`);
      return {threads:await pool((r.threads||[]).map(t=>t.id),6,thread)}},
    async get_thread({threadId}){return thread(threadId)}
  };
})();

function linkedGmail(){return (acctUser&&acctUser.user_metadata&&acctUser.user_metadata.gmail)||''}
function inboxGate(){
  if(!SB||acctUser)return null;
  return '<div class="empty">Sign in to connect your Gmail. The inbox finds replies from companies you applied to and is tied to your account.<br><br><button type="button" class="copy" id="inboxSignIn">Sign in</button></div>';
}
function inboxBar(){
  const em=linkedGmail();
  if(!em)return '';
  return `<div class="inbox-bar">Connected Gmail: <b>${esc(em)}</b><button type="button" class="tk-rm" id="gmDisconnect">Disconnect</button></div>`;
}
document.addEventListener('click',async e=>{
  if(e.target.closest('#inboxSignIn')){const p=document.getElementById('acctPanel');p.hidden=false;window.scrollTo({top:0,behavior:'smooth'});setTimeout(()=>document.getElementById('acctEmail').focus(),300);e.stopPropagation()}
  if(e.target.closest('#gmDisconnect')&&GmailApi){await GmailApi.disconnect();INBOX=null;inboxState='idle';renderInbox()}
},true);
document.getElementById('tabInbox').addEventListener('click',()=>setTimeout(()=>{
  // opening the tab only checks automatically when it can do so without a Google popup
  if(GmailApi&&linkedGmail()&&!INBOX&&inboxState!=='loading'&&GmailApi.canCheckQuietly()){GmailApi.setSilent(true);loadInbox().finally(()=>GmailApi.setSilent(false))}
},0));

/* Real company logos from Logo.dev (needs LOGO_TOKEN in config.js). Initials show if a logo is missing. */
const GENERIC=/^(careers?|jobs?|echo|anders|ia|ryan|stout|simon|wonder|awe|ntst|barr|cbh|tel|td)$/i;
function logoSrc(co){
  if(!CFG.LOGO_TOKEN)return '';
  const q=`?token=${encodeURIComponent(CFG.LOGO_TOKEN)}&size=128&format=png&retina=true&fallback=404`;
  const d=(window.DOMAINS||{})[co];
  if(d)return `https://img.logo.dev/${encodeURIComponent(d)}${q}`;
  if(CFG.LOGO_NAME_LOOKUP===false||co.length<4||GENERIC.test(co)||/^[a-z0-9-]+$/.test(co))return '';
  return `https://img.logo.dev/name/${encodeURIComponent(co)}${q}`;
}

const FIELDS=[
 ['Engineering & Tech',[['Software','Software Engineering'],['AI/ML/Data','AI, ML & Data Science'],['Hardware','Electrical & Computer Engineering'],['Mechanical','Mechanical, Aerospace & Robotics'],['Engineering','Civil, Industrial & General Engineering'],['IT','IT & Cybersecurity'],['Product','Product, UX & Design']]],
 ['Business',[['Finance','Finance, Accounting & Insurance'],['Quant','Quant & Trading'],['Consulting','Consulting'],['Business','Operations, Supply Chain & Management'],['Marketing','Marketing, PR & Advertising'],['Sales','Sales & Business Development'],['HR','Human Resources'],['RealEstate','Real Estate, Construction & Architecture'],['Retail','Retail, Fashion & Consumer Goods']]],
 ['Science & Health',[['Science','Science, Biotech & Lab Research'],['Healthcare','Healthcare, Nursing & Public Health'],['Marine','Marine, Atmospheric & Earth Science'],['Environment','Environment & Energy']]],
 ['Arts, Media & Society',[['Media','Media, Film & Journalism'],['Music','Music & Audio'],['Arts','Art, Museums, Theatre & Architecture'],['Hospitality','Hospitality, Travel & Events'],['Sports','Sports'],['Legal','Law, Government & Policy'],['Education','Education & Teaching'],['Nonprofit','Nonprofit & Social Impact']]],
];
const MAJORS=[
 ['Architecture & Design',[['Architecture',['Arts','RealEstate'],['architect','design']],["Interior Design",["Arts", "RealEstate"],["interior", "design"]],["Graphic Design",["Product", "Marketing", "Arts"],["graphic", "design", "creative", "visual"]],["Industrial / Product Design",["Product", "Engineering"],["industrial design", "product design"]],["Urban Planning",["RealEstate", "Legal", "Environment"],["planning", "urban", "gis"]],["Landscape Architecture",["RealEstate", "Environment", "Arts"],["landscape"]],["Construction Management",["RealEstate", "Engineering"],["construction", "project"]],["Fashion Design",["Retail", "Arts"],["fashion", "design", "apparel"]]]],
 ['Arts, Humanities & Sciences',[
  ['Africana Studies',['Nonprofit','Education','Legal'],[]],['American Studies',['Nonprofit','Media','Legal'],[]],['Anthropology',['Science','Nonprofit','Arts'],['research']],
  ['Art and Art History',['Arts','Media'],['museum','gallery','art']],['Astronomy / Physics',['Science','Mechanical','AI/ML/Data'],['physics','research']],
  ['Biochemistry and Molecular Biology',['Science','Healthcare'],['biology','chemistry','research']],['Biology',['Science','Healthcare','Marine'],['biology','research']],
  ['Chemistry',['Science','Engineering'],['chemistry','chemical']],['Classics',['Arts','Education','Nonprofit'],[]],['Computer Science',['Software','AI/ML/Data','IT'],[]],
  ['Criminology',['Legal','Nonprofit'],['policy','compliance','investigat']],['Cuban Studies',['Nonprofit','Legal','Media'],[]],['Economics',['Finance','Consulting','Business','Legal'],['economic','analyst']],
  ['Ecosystem Science and Policy',['Environment','Marine','Legal'],['environmental','sustainab']],['English and Creative Writing',['Media','Marketing','Education'],['writ','editorial','content']],
  ['Gender and Sexuality Studies',['Nonprofit','Legal'],[]],['Geography and Sustainable Development',['Environment','RealEstate','Legal'],['gis','sustainab','planning']],
  ['Global Health Studies',['Healthcare','Nonprofit','Science'],['health']],['History',['Arts','Legal','Education','Nonprofit'],['research','archiv']],
  ['International Studies',['Legal','Nonprofit','Consulting'],['international','policy']],['Judaic Studies',['Nonprofit','Education'],[]],['Latin American Studies',['Legal','Nonprofit','Business'],['international','spanish']],
  ['Mathematics',['Quant','AI/ML/Data','Finance','Software'],['math','quant','actuar']],['Microbiology and Immunology',['Science','Healthcare'],['biology','lab']],
  ['Modern Languages (French / Spanish)',['Education','Legal','Hospitality','Marketing'],['spanish','bilingual','french','international']],['Neuroscience',['Science','Healthcare'],['neuro','research']],
  ['Philosophy',['Legal','Nonprofit','Consulting'],['policy','ethic']],['Political Science',['Legal','Nonprofit','Consulting'],['policy','government']],
  ['Psychology',['Healthcare','Science','HR','Education'],['psych','research','behavior']],['Religious Studies',['Nonprofit','Education'],[]],
  ['Sociology',['Nonprofit','Healthcare','HR','Legal'],['research','community']],['Theatre Arts',['Arts','Media','Music'],['theatre','production','stage']],
  ['Writing Studies',['Media','Marketing','Education'],['writ','content','editorial']],['Liberal Arts / Innovation and Society',['Business','Nonprofit','Media'],[]],["Statistics",["AI/ML/Data", "Quant", "Finance"],["statistic", "data", "analytics"]],["Environmental Science",["Environment", "Science", "Marine"],["environmental", "sustainab"]],["Linguistics",["Education", "Software", "Media"],["language", "linguist", "nlp"]],["Public Policy",["Legal", "Nonprofit", "Consulting"],["policy", "government"]],["Social Work",["Nonprofit", "Healthcare"],["social work", "case", "community"]],["Criminal Justice",["Legal", "Nonprofit"],["justice", "investigat", "legal", "compliance"]],["Pre-Med / Biomedical Sciences",["Healthcare", "Science"],["clinical", "research", "medical"]],["Studio Art / Fine Arts",["Arts", "Media"],["art", "design", "studio"]],["Dance",["Arts", "Music", "Education"],["dance"]],["Photography",["Media", "Arts"],["photo", "visual"]],["Game Design",["Software", "Media", "Arts"],["game"]],["Animation",["Media", "Arts"],["animation", "3d", "motion"]],["Paralegal / Legal Studies",["Legal"],["legal", "paralegal", "law"]],["Geography / GIS",["Environment", "RealEstate"],["gis", "geospatial", "mapping"]]]],
 ['Business',[
  ['Accounting',['Finance'],['accounting','audit','tax']],['AI Technologies for Business',['AI/ML/Data','Business','Consulting'],['ai','analytics']],['Business Analytics',['AI/ML/Data','Business','Consulting'],['analytics','analyst']],
  ['Business Technology',['IT','Business','Product'],['technology','systems']],['Economics (Business)',['Finance','Consulting','Quant'],['economic','analyst']],['Entrepreneurship',['Business','Product','Marketing'],['startup','strategy']],
  ['Finance',['Finance','Quant','Consulting','RealEstate'],[]],['Health Management and Policy',['Healthcare','Business','Consulting'],['health']],['Human Resource Management',['HR','Business'],[]],
  ['Legal Studies',['Legal','Business'],['legal','compliance']],['Management / Organizational Leadership',['Business','Consulting','HR'],[]],['Marketing',['Marketing','Retail','Sales'],[]],
  ['Real Estate',['RealEstate','Finance'],[]],['Supply Chain Analytics',['Business','Retail'],['supply chain','logistic','operations']],['Global / Sustainable Business',['Business','Environment','Consulting'],['international','sustainab']],["Business Administration",["Business", "Finance", "Marketing", "Consulting"],[]],["International Business",["Business", "Finance", "Consulting"],["international", "global"]],["Hospitality Management",["Hospitality", "Business"],["hotel", "hospitality", "guest", "events", "resort"]],["Sport Management",["Sports", "Business", "Marketing"],["sports"]],["Information Systems (MIS)",["IT", "Business", "AI/ML/Data"],["systems", "analyst"]],["Actuarial Science",["Finance", "Quant"],["actuar", "insurance", "risk"]],["Operations Management",["Business"],["operations", "supply chain", "logistic"]],["Fashion Merchandising",["Retail", "Marketing"],["merchandis", "fashion", "buying", "retail"]],["Retail Management",["Retail", "Sales"],["retail", "store"]],["Event Management",["Hospitality", "Marketing"],["event"]],["Tourism Management",["Hospitality"],["travel", "tourism"]],["Risk Management & Insurance",["Finance"],["insurance", "risk", "underwrit"]]]],
 ['Communication & Media',[
  ['Advertising',['Marketing','Media'],['advertis','brand','creative']],['Public Relations',['Marketing','Media'],['communications','public relations','pr']],['Communication Studies',['Marketing','Media','HR'],['communications']],
  ['Digital Storytelling and Content Creation',['Media','Marketing'],['content','social media','video']],['Journalism / Broadcast Journalism',['Media'],['news','journalis','broadcast']],['Media Management',['Media','Business','Marketing'],[]],
  ['Immersive Media',['Media','Product','Software'],['vr','ar','3d','game']],['Human-Centered Design & Computing',['Product','Software'],['ux','design']],['Motion Pictures',['Media','Arts'],['film','production','video']]]],
 ['Education & Human Development',[
  ['Applied Physiology / Sports Medicine',['Healthcare','Sports','Science'],['athletic','physiology','sports medicine']],['Community and Applied Psychological Studies',['Nonprofit','Healthcare','Education'],['community','psych']],
  ['Data Analytics and Intelligence for Social Impact',['AI/ML/Data','Nonprofit'],['data','analytics']],['Elementary / Exceptional Student Education',['Education','Nonprofit'],['teach']],['Sports Administration',['Sports','Business','Marketing'],['sports']],["Early Childhood Education",["Education", "Nonprofit"],["teach", "child", "youth"]],["Secondary Education",["Education"],["teach"]],["Special Education",["Education", "Healthcare"],["teach", "special"]],["Kinesiology / Exercise Science",["Healthcare", "Sports", "Science"],["exercise", "athletic", "fitness", "strength"]],["Recreation & Parks Management",["Nonprofit", "Sports", "Environment"],["recreation", "parks", "camp"]]]],
 ['Engineering & Computing',[
  ['Aerospace Engineering',['Mechanical','Engineering'],['aerospace','aero','aeronaut','astronaut','aircraft','airframe','flight','propulsion','avionics','space','spacecraft','satellite','rocket','launch','orbital','uav','drone','gnc','guidance','hypersonic','turbine','jet engine','missile','aviation','wind tunnel','aerodynamic','composites','structures']],['Architectural Engineering',['Engineering','RealEstate'],['building','structural','mep']],['Biomedical Engineering',['Engineering','Science','Healthcare'],['medical','biomedical','device']],
  ['Chemical Engineering',['Engineering','Science'],['chemical','process']],['Civil / Environmental Engineering',['Engineering','Environment','RealEstate'],['civil','environmental','water']],['Computer Engineering',['Hardware','Software','AI/ML/Data'],[]],
  ['Electrical Engineering',['Hardware','Engineering'],[]],['Engineering Science',['Engineering','Mechanical','Hardware'],[]],['Industrial Engineering',['Engineering','Business'],['industrial','manufactur','operations']],
  ['Innovation, Technology and Design',['Product','Engineering'],['design','prototype']],['Mechanical Engineering',['Mechanical','Engineering'],[]],['Software Engineering',['Software','IT'],[]],["Data Science",["AI/ML/Data", "Software"],["data"]],["Cybersecurity",["IT", "Software"],["security", "cyber"]],["Information Technology",["IT", "Software"],["network", "support", "systems"]],["Materials Science & Engineering",["Engineering", "Science", "Hardware"],["materials", "metallurg", "process"]],["Nuclear Engineering",["Engineering", "Environment"],["nuclear", "reactor"]],["Petroleum Engineering",["Engineering", "Environment"],["petroleum", "drilling", "reservoir", "energy"]],["Systems Engineering",["Engineering", "Mechanical", "Hardware"],["systems"]],["Robotics Engineering",["Mechanical", "Hardware", "AI/ML/Data"],["robot", "autonomy"]],["Aviation / Aeronautics",["Mechanical", "Hospitality"],["aviation", "flight", "airline", "aircraft"]],["Agricultural Engineering",["Engineering", "Environment"],["agri", "irrigation"]]]],
 ['Marine, Atmospheric & Earth Science',[
  ['Geological Sciences',['Marine','Environment','Engineering'],['geolog','geoscience','environmental']],['Marine Biology and Ecology',['Marine','Science','Environment'],['marine','biology','ecology']],
  ['Marine Science / Oceanography',['Marine','Science','Environment'],['ocean','marine']],['Meteorology',['Marine','Environment'],['meteorolog','weather','climate','atmospheric']],['Marine Affairs',['Marine','Legal','Environment'],['policy','marine','coastal']]]],
 ['Music',[
  ['Music Performance (Instrumental / Keyboard / Vocal)',['Music','Arts'],[]],['Studio Jazz',['Music','Arts'],[]],['Music Education',['Music','Education'],['teach']],['Music Therapy',['Music','Healthcare'],['therapy']],
  ['Music Theory and Composition / Media Scoring',['Music','Media'],['composer','scoring','audio']],['Music Industry / Artist Development',['Music','Media','Marketing'],['music','label','artist']],['Audio / Music Engineering Technology',['Music','Hardware','Software'],['audio','sound','dsp']]]],
 ['Nursing & Health',[
  ['Nursing (BSN)',['Healthcare'],['nurs','patient care','bedside']],['Health Science',['Healthcare','Science'],['health','clinical']],['Public Health',['Healthcare','Nonprofit','Legal'],['public health','health']],["Pharmacy / Pharmaceutical Sciences",["Healthcare", "Science"],["pharma", "pharmacy", "drug"]],["Health Administration",["Healthcare", "Business"],["health", "administration"]],["Medical Laboratory Science",["Healthcare", "Science"],["lab", "clinical"]],["Communication Sciences & Disorders",["Healthcare", "Education"],["speech", "audiology"]],["Pre-Physical / Occupational Therapy",["Healthcare", "Sports"],["therapy", "rehab"]],["Nutrition & Dietetics",["Healthcare", "Science"],["nutrition", "dietetic", "wellness"]]]],,
 ['Agriculture, Food & Natural Resources',[["Agricultural Business",["Business","Environment"],["agri","farm","agronom"]],["Animal Science",["Science","Healthcare"],["animal","veterin"]],["Food Science",["Science","Retail"],["food","quality"]],["Forestry / Wildlife Biology",["Environment","Marine"],["forest","wildlife","conservation"]]]]
];
const CAT=Object.fromEntries(FIELDS.flatMap(g=>g[1]));
const SUM=window.SUMMARIES||{};
const L=window.LISTINGS.map((r,i)=>({id:i,co:r[0],title:r[1],cats:r[2],cat:r[2][0],terms:r[3],locs:r[4],deg:r[5],sp:r[6],t:r[7],url:r[8],pay:r[9]||'',prog:r[10]==='p',about:r[11]||'',rt:r[12]||0,brand:r[13]||0,hr:r[14]||null,unpaid:r[15]==='u',f500:!!(window.F500||{})[r[0]],sum:SUM[r[8]]||null,
  hay:(r[0]+' '+r[1]+' '+r[4].join(' ')).toLowerCase()}));
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const counts={};L.forEach(x=>x.cats.forEach(c=>counts[c]=(counts[c]||0)+1));
$('field').innerHTML='<option value="">Any field</option>'+FIELDS.map(([g,fs])=>`<optgroup label="${esc(g)}">`+fs.map(([k,v])=>`<option value="${esc(k)}">${esc(v)} (${(counts[k]||0).toLocaleString()})</option>`).join('')+'</optgroup>').join('');
// Companies whose engineering internships count as aerospace even when the title doesn't say so
const AERO_CO=/\b(spacex|blue origin|boeing|lockheed|northrop|rtx|raytheon|pratt|collins aerospace|ge aerospace|general dynamics|gulfstream|textron|bell|sierra space|rocket lab|relativity|firefly|axiom|vast|astranis|planet|anduril|shield ai|joby|archer|wisk|beta technologies|nasa|jpl|jet propulsion|aerospace corporation|honeywell aerospace|l3harris|bae systems|embraer|airbus|safran|rolls-royce|spirit aerosystems|textron aviation|cirrus|piper|ula|united launch|virgin galactic|varda|stoke space|hermeus|boom supersonic|zipline|skydio|ball aerospace|maxar|york space|terran orbital|aerojet|kratos|general atomics|leidos|draper)\b/i;
const CO_RE={'Aerospace Engineering':AERO_CO,'Aviation / Aeronautics':AERO_CO};
const MAJ={};MAJORS.forEach(([sch,ms])=>ms.forEach(([n,f,k])=>MAJ[n]={f,k,re:k.length?new RegExp('\\b('+k.map(w=>w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+(w.length<=3?'\\b':'')).join('|')+')','i'):null}));
$('major').innerHTML='<option value="">Choose your major…</option>'+MAJORS.map(([sch,ms])=>`<optgroup label="${esc(sch)}">`+ms.map(([n])=>`<option>${esc(n)}</option>`).join('')+'</optgroup>').join('');
$('asof').textContent='Updated '+new Date(window.LISTINGS_ASOF*1000).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+'';
const years=[...new Set(L.flatMap(x=>x.terms.map(t=>t.split(' ')[1])))].sort();
$('year').innerHTML='<option value="">Any year</option>'+years.map(y=>`<option>${y}</option>`).join('');
const DEG=["Bachelor's","Master's","PhD","Associate's"];
$('degrees').insertAdjacentHTML('beforeend',DEG.map((d,i)=>`<label class="ck"><input type="checkbox" id="deg${i}" value="${d}"> ${d}</label>`).join(''));

/* ---- Locations: which U.S. state (or other country) each listing is in ---- */
const STATES={AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',PR:'Puerto Rico'};
const ST_BY_NAME=Object.fromEntries(Object.entries(STATES).map(([c,n])=>[n.toLowerCase(),c]));
const ST_NAME_RE=new RegExp('\\b('+Object.values(STATES).map(n=>n.toLowerCase()).sort((a,b)=>b.length-a.length).join('|')+')\\b','g');
const CITY_ST={'nyc':'NY','new york city':'NY','manhattan':'NY','brooklyn':'NY','sf':'CA','south sf':'CA','san francisco':'CA','bay area':'CA','la':'CA','los angeles':'CA','san jose':'CA','palo alto':'CA','mountain view':'CA','sunnyvale':'CA','santa clara':'CA','menlo park':'CA','san diego':'CA','irvine':'CA','el segundo':'CA','cupertino':'CA','seattle':'WA','redmond':'WA','bellevue':'WA','boston':'MA','chicago':'IL','austin':'TX','houston':'TX','dallas':'TX','atlanta':'GA','miami':'FL','denver':'CO','boulder':'CO','pittsburgh':'PA','philadelphia':'PA','cincinnati':'OH','detroit':'MI','phoenix':'AZ','washington dc':'DC','washington, dc':'DC','d.c.':'DC','nashville':'TN','minneapolis':'MN','salt lake city':'UT','raleigh':'NC','charlotte':'NC','portland':'OR'};
const FOREIGN=/\b(canada|ontario|quebec|british columbia|alberta|united kingdom|england|scotland|wales|ireland|london|india|bangalore|bengaluru|hyderabad|pune|singapore|france|paris|germany|berlin|munich|netherlands|amsterdam|spain|madrid|italy|milan|switzerland|zurich|geneva|china|shanghai|beijing|shenzhen|hong kong|japan|tokyo|korea|seoul|taiwan|taipei|australia|sydney|melbourne|new zealand|mexico city|brazil|israel|tel aviv|poland|sweden|denmark|finland|norway|belgium|austria|vienna, austria|portugal|lisbon|dublin|toronto|vancouver|montreal|ottawa|waterloo|calgary|edmonton|winnipeg|halifax|mississauga|malaysia|kuala lumpur|thailand|vietnam|philippines|indonesia|jakarta|uae|dubai|luxembourg|brussels|brno|czech|peru|colombia|bogota|eindhoven|mallorca|sgp|chile|argentina|costa rica|egypt|south africa|nigeria|kenya|turkey|istanbul|greece|hungary|budapest|romania|bucharest|prague|warsaw|krakow|stockholm|copenhagen|oslo|helsinki|edinburgh|manchester|cambridge, uk|oxford, uk|belfast|cork|galway)\b/i;
const FOREIGN_CODE=/(,|\s|-)\s*(UK|GB|ON|BC|QC|AB|SK|MB|NS|IE|SG|IN, India|DE|FR|NL|ES|IT|CH|CN|JP|KR|TW|AU|NZ|MX|BR|IL|PL|SE|HK|MY|TH|VN|PH)\s*$/;
function locState(l){
  const t=l.replace(/\((\+\d+|headquarters|hq|hybrid|on-?site)\)/ig,'').trim();if(!t)return null;
  if(/\b(AB|BC|ON|QC|MB|SK|NS|NB|NL|PE)\s*,\s*CA(N|NADA)?\b/.test(t))return 'X';
  const lead=t.match(/^([A-Z]{2})[\s-]+[A-Z][a-z]/);if(lead&&STATES[lead[1]])return lead[1];
  if(/\bdistrict of columbia\b|washington,?\s*d\.?c\b/i.test(t))return 'DC';
  if(/\bvienna\b/i.test(t)&&!/,\s*VA\b|virginia/i.test(t))return 'X';
  const parts=t.split(/\s*[,|/–-]\s*|\s+(?=USA$|United States$)/).map(x=>x.trim()).filter(Boolean);
  for(let i=parts.length-1;i>=0;i--){const p=parts[i];
    if(/^[A-Z]{2}$/.test(p)&&STATES[p]&&!(p==='IN'&&/\bindia\b/i.test(t))&&!(i===0&&parts.length>1))return p;
    const n=ST_BY_NAME[p.toLowerCase()];if(n&&!(n==='GA'&&/tbilisi/i.test(t))&&!(n==='WA'&&i===0&&parts.length>1&&ST_BY_NAME[(parts[1]||'').toLowerCase()]))return n;}
  if(FOREIGN.test(t)||FOREIGN_CODE.test(t))return 'X';
  const low=t.toLowerCase();
  for(const [c,st] of Object.entries(CITY_ST))if(low===c||low.startsWith(c+' ')||low.startsWith(c+','))return st;
  if(/united states|\busa\b|\bu\.s\.?\b|^us\b|\bus$|remote in us/i.test(t))return 'US';
  return null;
}
$('loc').innerHTML='<option value="">Anywhere</option><option value="REMOTE">Remote</option>'+Object.entries(STATES).sort((a,b)=>a[1].localeCompare(b[1])).map(([c,n])=>`<option value="${c}">${n}</option>`).join('')+'<option value="X">Outside the U.S.</option>';
const US={test:l=>{const c=locState(l);return !!c&&c!=='X'}};
L.forEach(x=>{x.st=new Set(x.locs.map(locState).filter(Boolean))});
let state={major:'',field:'',season:'',year:'',kw:'',sort:'rel',remote:false,usonly:false,nocit:false,deg:[],paidonly:true,known:false,f500:false,loc:''};
try{const s=localStorage.getItem('if-sort');if(s)state.sort=s}catch(e){} // every visit starts with a clear search; only the sort order is remembered
if(state.field&&!CAT[state.field])state.field='';if(state.major&&!MAJ[state.major])state.major='';

function apply(){
  $('major').value=state.major;$('field').value=state.field;$('season').value=state.season;$('year').value=years.includes(state.year)?state.year:'';
  $('kw').value=state.kw;$('sort').value=state.sort;$('remote').checked=state.remote;$('usonly').checked=state.usonly;$('nocit').checked=state.nocit;$('paidonly').checked=state.paidonly;$('known').checked=state.known;$('f500').checked=state.f500;$('loc').value=state.loc;
  DEG.forEach((d,i)=>$('deg'+i).checked=state.deg.includes(d));
}
function read(){
  state.major=$('major').value;state.field=$('field').value;state.season=$('season').value;state.year=$('year').value;state.kw=$('kw').value.trim();
  state.sort=$('sort').value;state.remote=$('remote').checked;state.usonly=$('usonly').checked;state.nocit=$('nocit').checked;state.paidonly=$('paidonly').checked;state.known=$('known').checked;state.f500=$('f500').checked;state.loc=$('loc').value;
  state.deg=DEG.filter((d,i)=>$('deg'+i).checked);
  try{localStorage.setItem('if-sort',state.sort)}catch(e){}
}
function termOk(x){
  if(!state.season&&!state.year)return true;
  return x.terms.some(t=>{const[s,y]=t.split(' ');return(!state.season||s===state.season)&&(!state.year||y===state.year)});
}
function sideOk(x){
  if(state.remote&&!x.locs.some(l=>/remote/i.test(l)))return false;
  if(state.usonly&&![...x.st].some(c=>c!=='X'))return false;
  if(state.loc){if(state.loc==='REMOTE'){if(!x.locs.some(l=>/remote/i.test(l)))return false}
    else if(state.loc==='X'){if(!x.st.has('X'))return false}
    else if(!x.st.has(state.loc))return false}
  if(state.nocit&&x.sp==='cit')return false;
  if(state.paidonly&&x.unpaid)return false;
  if(state.known&&!x.prog&&x.brand<5)return false;
  if(state.f500&&!x.f500)return false;   // AI Rating doesn't recognize the company
  if(state.deg.length&&x.deg.length&&!x.deg.some(d=>state.deg.includes(d)))return false;
  return true;
}
/* How well a listing fits the chosen major or field (0 = leave it out).
   A job counts when it's mainly in the major's main field, mainly in a closely related field,
   or its title names something the major is about. Broad fields (Business, Marketing, Finance, Sales)
   only count for a major when the title also mentions the major's topics. */
const BROAD=new Set(['Business','Marketing','Finance','Sales','Consulting','Engineering']);
const TECH=new Set(['Software','Hardware','Mechanical','Engineering','IT','AI/ML/Data','Quant','Product']);
const TECHRE=/\b(engineer|engineering|software|developer|firmware|hardware|devops|data scien\w*|machine learning|cyber\w*|programmer|full[- ]?stack|back[- ]?end|front[- ]?end)\b/i;
let FIELDKW=null;
function fieldRe(f){
  if(!FIELDKW){FIELDKW={};for(const [k,arr] of Object.entries(TRY))FIELDKW[k]=new RegExp('\\b('+arr.map(w=>w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')','i')}
  return FIELDKW[f];
}
function relevance(x){
  const main=x.cats[0];
  const fs=state.field?[state.field]:(MAJ[state.major]||{f:[]}).f;
  if(!fs.some(f=>TECH.has(f))&&TECHRE.test(x.title))return 0;  // e.g. engineering jobs don't belong under Hospitality
  if(state.field){
    const f=state.field,re=fieldRe(f),hit=re&&re.test(x.title);
    if(main===f)return 6+(hit?3:0);
    if(x.cats.includes(f)&&hit)return 5;
    return 0;
  }
  const m=MAJ[state.major];if(!m)return 1;
  const kw=!!(m.re&&m.re.test(x.title))||!!(CO_RE[state.major]&&CO_RE[state.major].test(x.co)&&TECHRE.test(x.title));
  const p=m.f[0];
  let s=0;
  if(main===p)s=6;
  else if(m.f.slice(1).some(f=>main===f&&(!BROAD.has(f)||kw||BROAD.has(p))))s=4;
  else if(kw&&x.cats.includes(p))s=3;
  else if(kw&&!['Software','Hardware','Mechanical','Engineering','IT','AI/ML/Data','Quant'].includes(main)===!['Software','Hardware','Mechanical','Engineering','IT','AI/ML/Data','Quant'].includes(p))s=2;
  if(kw&&s)s+=4;
  return s;
}
// "NVIDIA California", "software engineer TX", "remote data" -> words to find + location filters
let _kwq=null,_kwqFor=null;
function KWQ(){
  if(_kwqFor===state.kw)return _kwq;
  let raw=state.kw,low=raw.toLowerCase();const states=[];let remote=false;
  low=low.replace(/\bwashington,?\s*d\.?c\.?(?=\s|$)/g,()=>{states.push('DC');return ' '});
  low=low.replace(ST_NAME_RE,m=>{states.push(ST_BY_NAME[m]);return ' '});
  // two-letter codes: only typed in capitals ("TX") or after a comma ("nvidia, ca"), so "in"/"or"/"me" stay words
  const toks=raw.replace(/\bwashington,?\s*d\.?c\.?/ig,' ').split(/\s+/);
  low=low.split(/\s+/).filter((w,i,arr)=>{
    const orig=(raw.match(new RegExp('(^|[\\s,])('+w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')(?=$|[\\s,])','i'))||[])[2]||'';
    const code=w.replace(/[,.]/g,'').toUpperCase();
    if(code.length===2&&STATES[code]&&(/^[A-Z]{2},?$/.test(orig)||new RegExp(',\\s*'+code+'\\b','i').test(raw))){states.push(code);return false}
    if(w==='remote'){remote=true;return false}
    return true}).join(' ');
  const words=low.replace(/,/g,' ').split(/\s+/).filter(w=>w&&!['in','near','at','the'].includes(w)||false);
  _kwqFor=state.kw;_kwq={states,remote,words};return _kwq;
}
function matches(x){
  if(newOnly&&!ADDED.has(x.url))return false;
  x.rel=(state.field||state.major)?relevance(x):0;
  if((state.field||state.major)&&!x.rel)return false;
  if(!termOk(x))return false;
  if(state._any&&!state._any.some(w=>x.hay.includes(w)))return false;
  if(state.kw){const q=KWQ();
    if(q.states.length&&!q.states.some(c=>x.st.has(c)))return false;
    if(q.remote&&!x.locs.some(l=>/remote/i.test(l)))return false;
    if(!q.words.every(w=>x.hay.includes(w)))return false}
  return sideOk(x);
}
const HUES=[212,262,188,330,24,150,280,4,48,120,232,350,170,300,36,200];
function hue(s){let h=0;for(const c of s)h=(h*31+c.charCodeAt(0))>>>0;return HUES[h%HUES.length]}
function hueL(s){let h=7;for(const c of s)h=(h*17+c.charCodeAt(0))>>>0;return 36+(h%3)*6}
const STOP=new Set(['the','of','and','&','inc','inc.','llc','co','co.','corp','corp.','corporation','company','group','ltd','ltd.','holdings','international','technologies','technology','usa','us','u.s.']);
function initials(name){
  const words=name.replace(/\(.*?\)/g,' ').replace(/[^A-Za-z0-9& .'-]/g,' ').split(/[\s-]+/).filter(Boolean);
  const sig=words.filter(w=>!STOP.has(w.toLowerCase()));
  const ws=sig.length?sig:words;
  if(!ws.length)return '?';
  const w0=ws[0];
  if(ws.length===1||/^[A-Z0-9]{2,}$/.test(w0)){
    if(/^[A-Z0-9]{2,4}$/.test(w0))return w0.slice(0,3);
    if(/^[A-Z0-9]{5,}$/.test(w0))return w0.slice(0,2);
    return w0[0].toUpperCase()+(w0[1]||'').toLowerCase();
  }
  return (w0[0]+ws[1][0]).toUpperCase();
}
const fmt=t=>t?new Date(t*1000).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'—';
const SP={'':'Not stated in the listing summary; check the posting','no':'Does not offer visa sponsorship','cit':'U.S. citizenship required','yes':'Offers visa sponsorship'};

const SK=[['Python',/python/i],['C++',/c\+\+/i],['Java',/\bjava\b/i],['JavaScript',/javascript|typescript|\bnode\b/i],['React',/\breact\b/i],['SQL',/\bsql\b/i],['Excel',/\bexcel\b/i],['Machine learning',/machine learning|\bml\b|deep learning/i],['AI',/\bai\b|artificial intel|\bllm|genai|generative/i],['GPU',/\bgpu|cuda/i],['FPGA',/fpga/i],['Verilog',/verilog|\bvhdl\b/i],['RTL / ASIC',/\brtl\b|asic|silicon|\bsoc\b|chip design/i],['Embedded',/embedded|firmware/i],['Hardware',/hardware/i],['Robotics',/robot/i],['Cloud',/cloud|\baws\b|azure|\bgcp\b/i],['Linux',/linux/i],['Security',/security|cyber/i],['Mobile',/\bios\b|android|mobile/i],['Backend',/backend|back-end|distributed|infrastructure/i],['Frontend',/frontend|front-end|full.?stack|\bweb\b/i],['Data',/\bdata\b/i],['Analytics',/analytic|tableau|power bi/i],['CAD',/\bcad\b|solidworks|creo|catia/i],['MATLAB',/matlab|simulink/i],['Research',/research/i],['Audit',/audit/i],['Tax',/\btax\b/i],['Accounting',/accounting/i],['Supply chain',/supply chain|logistic|procure|sourcing/i],['Social media',/social media|content creat/i],['Communications',/communication|public relations|\bpr\b/i],['Design',/\bdesign\b|\bux\b|\bui\b/i],['Sales',/\bsales\b/i],['Policy',/policy|government/i],['Clinical',/clinical|patient|nurs/i],['Lab',/\blab\b|laborator/i],['Events',/event|guest|hotel|resort/i]];
function skills(x){const txt=x.title+' '+(x.sum?(x.sum.r||'')+' '+(x.sum.l||''):'');const out=[];for(const [n,re] of SK){if(re.test(txt))out.push(n);if(out.length>=4)break}return out}
function ago(t){if(!t)return '';const s=Date.now()/1000-t;if(s<3600)return Math.max(1,Math.round(s/60))+'m ago';if(s<86400)return Math.round(s/3600)+'h ago';const d=Math.round(s/86400);if(d<45)return d+'d ago';return fmt(t)}
const ICO={pin:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  cal:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  pay:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.4 0-2.5.8-2.5 2s1.1 1.7 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1.1 0-2-.4-2.5-1.2M12 6.5v11"/></svg>'};
function logo(co){const t=initials(co);const s=logoSrc(co);return `<span class="logo${t.length>2?' l3':''}" style="--h:${hue(co)}" aria-hidden="true">${esc(t)}${s?`<img src="${esc(s)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">`:''}</span>`}
function ringColor(v){ // dull red (low) -> amber -> green (high)
  const k=Math.max(0,Math.min(1,(v-1.5)/8));
  return `hsl(${Math.round(Math.pow(k,1.4)*135)} ${Math.round(48+k*20)}% var(--ring-l))`;
}
function ring(v,big){const c=v>=8?'r-hi':v>=5?'r-mid':'r-lo';return `<span class="ring ${c}${big?' big':''}" style="--v:${Math.round(v*10)};--c:${ringColor(v)}" title="Rating out of 10"><b>${v.toFixed(1)}</b></span>`}
function brandLabel(b){return b>=9.8?'Top-tier, very well known company':b>=9?'Very well known company':b>=8?'Well known company':b>=6.5?'Established company':b>=5?'Smaller, known company':'Less well known company'}
function card(x,m){
  const now=Date.now()/1000;
  let host='';try{host=new URL(x.url).hostname.replace(/^www\./,'')}catch(e){}
  const loc=x.locs.length?(x.locs.length>2?x.locs.slice(0,2).join(' · ')+` +${x.locs.length-2}`:x.locs.join(' · ')):'Location not listed';
  const fresh=!x.prog&&now-x.t<3*86400;
  const term=x.prog&&x.terms.length>2?'Several terms':x.terms.join(', ');
  const tags=skills(x).map(s=>`<span class="tag skill">${esc(s)}</span>`).join('')
    +(x.locs.some(l=>/remote/i.test(l))?'<span class="tag good">Remote</span>':'')
    +(x.sp==='cit'?'<span class="tag warn">U.S. citizen</span>':'')
    +`<span data-tracktag="${appKey(x.url)}">${trackTag(x.url)}</span>`+(x.prog?'<span class="tag prog">Program page</span>':'')+(x.sum?'<span class="tag ai">AI summary</span>':'')
    +(x.deg.length?`<span class="tag">${esc(x.deg.map(d=>d.replace("'s","").replace('Bachelor','BS').replace('Master','MS').replace('Associate','AS')).join('/'))}</span>`:'');
  const pay=x.pay||(x.hr?'$'+x.hr+'/hr':'');
  const right=m?`<span class="fit">${m.score}<small>fit</small></span>`:`${ring(x.rt)}${x.prog?'':`<span class="ago">${esc(ago(x.t))}</span>`}`;
  return `<details class="item">
    <summary>
      ${logo(x.co)}
      <span class="body">
        <span class="coline"><span class="cn">${esc(x.co)}</span>${ADDED.has(x.url)?'<span class="new just">Just added</span>':fresh?'<span class="new">New</span>':''}</span>
        <span class="title">${esc(x.title)}</span>
        <span class="facts"><span>${ICO.pin}${esc(loc)}</span>${term?`<span>${ICO.cal}${esc(term)}</span>`:''}${pay?`<span>${ICO.pay}${esc(pay)}</span>`:''}</span>
        ${m?`<span class="why">${esc(m.why)}${m.gap?`<span class="gap">To stand out: ${esc(m.gap)}</span>`:''}</span>`:''}<span class="meta">${tags}</span></span>
      <span class="right">${right}</span>
    </summary>
    <div class="ticket">
      ${x.sum?`<div class="aisum"><span class="lbl">AI summary of the posting</span>
        ${x.sum.a?`<p><b>The company</b>${esc(x.sum.a)}</p>`:''}
        ${x.sum.r?`<p><b>Your role</b>${esc(x.sum.r)}</p>`:''}
        ${x.sum.l?`<p><b>What they want</b>${esc(x.sum.l)}</p>`:''}</div>`:x.prog&&x.about?`<div class="aisum"><span class="lbl">About this program</span><p>${esc(x.about)}</p></div>`:''}
      <div class="rbox">${ring(x.rt,true)}<div><b>AI Rating</b><span>${esc(brandLabel(x.brand))} · ${x.hr?esc('Pay about $'+x.hr+'/hr'):'Pay not listed (estimated)'} · ${esc(x.cat||'General')} role${x.unpaid?' · Unpaid':''}</span><small class="rhow">Company 50% · Pay 30% · Type of role 20%, plus how recently it was posted</small></div></div>
      <dl class="dl">
        <dt>Company</dt><dd>${esc(x.co)}</dd>
        <dt>Role</dt><dd>${esc(x.title)}</dd>
        <dt>Field</dt><dd>${esc(x.cats.map(c=>CAT[c]||c).join(", "))}</dd>
        <dt>Term</dt><dd>${esc(x.prog&&x.terms.length>2?'Check the program page for terms':x.terms.join(', '))}</dd>
        <dt>Location</dt><dd>${esc(x.locs.join('; ')||'Not listed')}</dd>
        ${(x.pay||x.sum?.p)?`<dt>Pay</dt><dd>${esc(x.pay||x.sum.p)}</dd>`:''}
        <dt>Degree</dt><dd>${esc(x.deg.length?x.deg.join(', ')+' students':'Not specified')}</dd>
        <dt>Work auth.</dt><dd>${esc(SP[x.sp])}</dd>
        ${x.prog?'':`<dt>Posted</dt><dd>${fmt(x.t)}</dd>`}
      </dl>
      <div class="cta">
        <a class="apply" href="${esc(x.url)}" target="_blank" rel="noopener">Apply on official site ↗</a>
        <span class="host">${esc(host)}</span>
        <button type="button" class="copy" data-url="${esc(x.url)}">Copy link</button>
        <div class="track" data-track="${appKey(x.url)}" data-url="${esc(x.url)}" data-id="${x.id}">${trackCtl(x.url)}</div>
      </div>
      <p class="note">${x.prog?'This links to the company\'s official internship program page. Open roles and deadlines are listed there.':x.sum?'Summary written by AI from the official posting. Check the posting for exact requirements and deadlines.':'The full job description, duties and skill requirements are on the official posting.'}</p>
    </div>
  </details>`;
}

/* hero stats, field chips, hiring-now strip */
(function(){
  const now=Date.now()/1000;
  const wk=L.filter(x=>!x.prog&&now-x.t<7*86400).length;
  const cos=new Set(L.map(x=>x.co.toLowerCase())).size;
  const top=L.filter(x=>x.rt>=8).length;
  $('stats').innerHTML=[[L.length,'open listings'],[wk,'new this week','hot'],[cos,'companies'],[top,'rated 8+']].map(([n,l,c])=>`<span class="stat ${c||''}"><b>${n.toLocaleString()}</b><span>${l}</span></span>`).join('')
    +`<button type="button" class="stat f5" id="f500Stat" title="Show only Fortune 500 companies"><b>${L.filter(x=>x.f500&&!x.unpaid).length.toLocaleString()}</b><span>Fortune 500 jobs</span></button>`;
  $('fieldChips').innerHTML=FIELDS.flatMap(g=>g[1]).filter(([k])=>counts[k]).map(([k,v])=>`<button type="button" class="chip" data-f="${esc(k)}" aria-pressed="false">${esc(v.split(/,| & /)[0])}<span class="n">${counts[k].toLocaleString()}</span></button>`).join('');
  const by={};L.forEach(x=>{if(x.prog)return;const k=x.co;(by[k]=by[k]||{co:k,n:0,rt:0}).n++;by[k].rt=Math.max(by[k].rt,x.rt)});
  const best=Object.values(by).filter(c=>c.n>=3).sort((a,b)=>b.rt*Math.log2(b.n+1)-a.rt*Math.log2(a.n+1)).slice(0,12);
  $('coStrip').innerHTML=best.map(c=>`<button type="button" class="cotile" data-co="${esc(c.co)}">${logo(c.co)}<span><b>${esc(c.co)}</b><small>${c.n} open · ${c.rt.toFixed(1)}</small></span></button>`).join('');
})();
function syncFieldChips(){document.querySelectorAll('#fieldChips .chip').forEach(c=>c.setAttribute('aria-pressed',c.dataset.f===state.field))}

// ---------- One search box for major or field, plus "Try" chips that follow it ----------
const ALIAS={'computer science':['cs','comp sci'],'computer engineering':['ece','ce','comp e'],'electrical engineering':['ee','ece'],'mechanical engineering':['meche','me'],
  'biomedical engineering':['bme'],'industrial engineering':['ie'],'business analytics':['ba'],'human resource management':['hr'],'public relations':['pr'],'finance':['fin'],'accounting':['acct']};
const STUDY=[
  ...FIELDS.flatMap(([g,fs])=>fs.map(([k,v])=>({kind:'field',key:k,label:v,sub:'Field · '+(counts[k]||0).toLocaleString()+' listings',hay:(v+' '+k+' '+g).toLowerCase()}))),
  ...MAJORS.flatMap(([sch,ms])=>ms.map(([n,f])=>({kind:'major',key:n,label:n,sub:sch.replace(/^(College|School) of (the )?/,''),
    hay:(n+' '+sch+' '+(ALIAS[n.toLowerCase().split(' (')[0]]||[]).join(' ')+' '+f.map(c=>CAT[c]).join(' ')).toLowerCase()})))
];
let comboItems=[],comboAt=-1;
function studyLabel(){return state.field?CAT[state.field]:state.major||''}
function syncStudy(){const i=$('study');if(document.activeElement!==i)i.value=studyLabel();$('studyClear').hidden=!i.value}
function comboFind(q){
  q=q.trim().toLowerCase();
  if(!q)return STUDY.filter(s=>s.kind==='field');
  const words=q.split(/\s+/);
  const hit=STUDY.filter(s=>words.every(w=>s.hay.includes(w)));
  return hit.sort((a,b)=>{const as=a.label.toLowerCase().startsWith(q)?0:1,bs=b.label.toLowerCase().startsWith(q)?0:1;const ae=a.label.toLowerCase()===q?0:1,be=b.label.toLowerCase()===q?0:1;return ae-be||(a.kind==='major'?0:1)-(b.kind==='major'?0:1)||as-bs}).slice(0,40);
}
function comboOpen(){
  const q=$('study').value;comboItems=comboFind(q===studyLabel()?'':q);comboAt=-1;
  const list=$('studyList');
  if(!comboItems.length){list.innerHTML=`<li class="combo-none">No major or field matches. Press Enter to search “${esc(q)}” as a keyword.</li>`}
  else{let last='';list.innerHTML=comboItems.map((s,i)=>{const head=s.kind!==last?`<li class="combo-head" role="presentation">${s.kind==='field'?(q&&q!==studyLabel()?'Fields':'Pick a field, or type your major'):'Majors'}</li>`:'';last=s.kind;
    return head+`<li role="option" id="opt${i}" data-i="${i}" class="combo-opt"><b>${esc(s.label)}</b></li>`}).join('')}
  list.hidden=false;$('study').setAttribute('aria-expanded','true');
}
function comboClose(){$('studyList').hidden=true;$('study').setAttribute('aria-expanded','false');$('study').removeAttribute('aria-activedescendant')}
function comboPick(s){
  if(s.kind==='field'){$('field').value=s.key;$('major').value=''}else{$('major').value=s.key;$('field').value=''}
  $('study').value=s.label;comboClose();run();
}
function comboMove(d){
  if($('studyList').hidden)comboOpen();
  const n=comboItems.length;if(!n)return;comboAt=(comboAt+d+n)%n;
  document.querySelectorAll('#studyList .combo-opt').forEach(li=>li.classList.toggle('on',+li.dataset.i===comboAt));
  const el=$('opt'+comboAt);if(el){el.scrollIntoView({block:'nearest'});$('study').setAttribute('aria-activedescendant','opt'+comboAt)}
}
$('study').addEventListener('focus',()=>{$('study').select();comboOpen();if(innerWidth<760){const y=$('study').getBoundingClientRect().top+scrollY-16;scrollTo({top:y,behavior:'smooth'})}});
$('study').addEventListener('input',()=>{comboOpen();$('studyClear').hidden=!$('study').value});
$('study').addEventListener('keydown',e=>{
  if(e.key==='ArrowDown'){e.preventDefault();comboMove(1)}
  else if(e.key==='ArrowUp'){e.preventDefault();comboMove(-1)}
  else if(e.key==='Escape'){$('study').value=studyLabel();comboClose()}
  else if(e.key==='Enter'){
    e.preventDefault();const q=$('study').value.trim();
    if(comboAt>=0&&comboItems[comboAt])return comboPick(comboItems[comboAt]);
    if(!q){$('major').value='';$('field').value='';comboClose();return run()}
    if(q===studyLabel()){comboClose();return run()}
    const m=comboFind(q);if(m.length)return comboPick(m[0]);
    $('kw').value=q;$('major').value='';$('field').value='';$('study').value='';comboClose();run();
  }
});
$('studyList').addEventListener('mousedown',e=>{const li=e.target.closest('.combo-opt');if(!li)return;e.preventDefault();comboPick(comboItems[+li.dataset.i])});
$('study').addEventListener('blur',()=>setTimeout(()=>{comboClose();syncStudy()},120));
$('studyClear').addEventListener('click',()=>{$('major').value='';$('field').value='';$('study').value='';run();$('study').focus()});

const TRY={
  Software:['Backend','Frontend','Full Stack','Mobile','iOS','Cloud','Infrastructure','Security','Platform','Game','Web','Machine Learning'],
  'AI/ML/Data':['Machine Learning','Data Science','Data Engineer','Analytics','AI','Research','Computer Vision','LLM','Robotics','Business Intelligence'],
  Hardware:['FPGA','ASIC','Embedded','Firmware','Verification','Hardware Design','PCB','Semiconductor','Power','RF','Test','GPU'],
  Mechanical:['Mechanical Design','Aerospace','Robotics','Manufacturing','Propulsion','Test','Automotive','Thermal'],
  Engineering:['Civil','Industrial','Chemical','Manufacturing','Quality','Process','Construction','Structural','Electrical'],
  IT:['Cybersecurity','Security','Network','IT Support','Cloud','Systems'],
  Product:['Product Manager','UX','Product Design','Research','Program Manager'],
  Finance:['Investment Banking','Accounting','Audit','Tax','Wealth','Risk','Treasury','Corporate Finance','Insurance','Analyst'],
  Quant:['Trading','Quantitative Research','Developer','Trader','Researcher'],
  Consulting:['Consulting','Strategy','Advisory','Technology Consulting','Operations'],
  Business:['Operations','Supply Chain','Logistics','Strategy','Project Management','Procurement','Business Development','Analyst'],
  Marketing:['Marketing','Social Media','Brand','Communications','Content','Digital','Public Relations','Advertising'],
  Sales:['Sales','Account','Business Development','Customer Success','Partnerships'],
  HR:['Human Resources','Recruiting','Talent','People'],
  RealEstate:['Real Estate','Construction','Project','Architecture','Property','Development'],
  Retail:['Merchandising','Buying','Retail','Fashion','Design','Store'],
  Science:['Research','Lab','Chemistry','Biology','Clinical','Quality'],
  Healthcare:['Clinical','Nursing','Health','Patient','Research','Public Health','Hospital'],
  Marine:['Marine','Ocean','Climate','Fisheries','Coastal','Research'],
  Environment:['Sustainability','Environmental','Energy','Solar','Water','Climate'],
  Media:['Production','Editorial','Video','Journalism','News','Film','Content'],
  Music:['Music','Audio','Production','Live','Marketing'],
  Arts:['Museum','Curatorial','Education','Collections','Theatre','Design'],
  Hospitality:['Hotel','Resort','Events','Guest','Culinary','Revenue','Theme Park','Cruise'],
  Sports:['Ticketing','Marketing','Partnerships','Operations','Community','Media','Analytics'],
  Legal:['Legal','Policy','Government','Compliance','Law','Public'],
  Education:['Teaching','Education','Tutor','Program','Youth'],
  Nonprofit:['Policy','Fundraising','Development','Program','Communications','Advocacy']
};
const TRY_ANY=['Engineering','Software','Finance','Marketing','Data','Design','Research','Operations','Healthcare','Hotel'];
const PLACES=['Remote','Miami','New York'];
function renderQuick(){
  let cands;
  if(state.field)cands=TRY[state.field]||[];
  else if(state.major&&MAJ[state.major]){const m=MAJ[state.major];
    cands=[...m.k.map(w=>w.replace(/\b\w/g,c=>c.toUpperCase())).filter(w=>w.length>2),...m.f.flatMap(f=>(TRY[f]||[]).slice(0,5))];}
  else cands=TRY_ANY;
  cands=[...new Set([...cands,...PLACES].map(s=>s.trim()))];
  const kw=state.kw;state.kw='';const base=L.filter(matches);state.kw=kw;
  const out=[];
  for(const c of cands){const w=c.toLowerCase();const n=base.filter(x=>x.hay.includes(w)).length;if(n)out.push([c,n]);if(out.length>=11)break}
  if(state.kw&&!out.some(([c])=>c.toLowerCase()===state.kw.toLowerCase()))out.unshift([state.kw,results.length]);
  $('quick').innerHTML='<small>Try:</small>'+out.map(([c,n])=>`<button type="button" class="chip" data-q="${esc(c)}" aria-pressed="${state.kw.toLowerCase()===c.toLowerCase()}">${esc(c)}<span class="n">${n.toLocaleString()}</span></button>`).join('');
}

const ADDED=new Set(window.ADDED_URLS||[]);const ADDED_N=L.filter(x=>ADDED.has(x.url)).length;let newOnly=false,beforeNew=null,f5New=false;const ADDED_F5=L.filter(x=>ADDED.has(x.url)&&x.f500&&!x.unpaid).length;
const F500_N=L.filter(x=>x.f500&&!x.unpaid).length,F500_CO=new Set(Object.values(window.F500||{})).size;
function renderF500(){
  const b=$('f500Pill');if(!F500_N){b.hidden=true;return}
  const searching=state.field||state.major||state.kw;
  const mine=searching?results.filter(x=>x.f500).length:0;
  b.setAttribute('aria-pressed',state.f500);
  const st=$('f500Stat');if(st)st.setAttribute('aria-pressed',state.f500);
  if(!state.f500&&!searching){b.hidden=true;return}
  b.innerHTML=state.f500?`Showing Fortune 500 only <span aria-hidden="true">×</span>`
    :`<b>${mine.toLocaleString()}</b> Fortune 500 jobs match your search`;
  b.title=state.f500?'Show all companies':'Show only Fortune 500 companies';b.hidden=false;
}
document.addEventListener('click',e=>{if(e.target.closest('#f500Pill,#f500Stat')){$('f500').checked=!$('f500').checked;run();if($('f500').checked)showResults()}});
function renderNewPill(){
  const pill=$('newPill');const n=ADDED_N;
  const f5=$('newF5');
  if(ADDED_F5&&!newOnly){f5.innerHTML=`<span class="star" aria-hidden="true">★</span> +${ADDED_F5.toLocaleString()} Fortune 500 job${ADDED_F5===1?'':'s'}<span class="long"> since the last update</span><span class="short"> new</span>`;f5.hidden=false}else f5.hidden=true;
  if(!n||newOnly){pill.hidden=true;return}
  const mine=(state.field||state.major||state.kw)?results.filter(x=>ADDED.has(x.url)).length:0;
  pill.innerHTML=`+${n.toLocaleString()} new job${n===1?'':'s'} since the last update${mine?` <small>· ${mine} match your search</small>`:''}`;
  pill.hidden=false;
}
document.addEventListener('click',e=>{
  if(e.target.closest('#newPill,#newF5')){f5New=!!e.target.closest('#newF5');if(f5New)$('f500').checked=true;beforeNew=['major','field','kw','season','year'].map(k=>[k,$(k).value]);newOnly=true;$('major').value='';$('field').value='';$('kw').value='';$('season').value='';$('year').value='';run();showResults()}
  else if(e.target.closest('#newOff')){newOnly=false;if(f5New){$('f500').checked=false;f5New=false}(beforeNew||[]).forEach(([k,v])=>{$(k).value=v});beforeNew=null;run()}
});
/* light / dark switch (remembered in this browser) */
const SUN='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg>';
const MOON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>';
function curTheme(){return document.documentElement.dataset.theme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}
function paintTheme(){const d=curTheme()==='dark';$('themeBtn').innerHTML=d?SUN:MOON;$('themeBtn').setAttribute('aria-label',d?'Switch to light mode':'Switch to dark mode');$('themeBtn').title=d?'Light mode':'Dark mode';
  const m=document.querySelector('meta[name="theme-color"]');if(m)m.content=d?'#0a0a0a':'#ffffff'}
try{const s=localStorage.getItem('if-theme');if(s)document.documentElement.dataset.theme=s}catch(e){}
$('themeBtn').addEventListener('click',()=>{const n=curTheme()==='dark'?'light':'dark';document.documentElement.dataset.theme=n;try{localStorage.setItem('if-theme',n)}catch(e){}paintTheme()});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',paintTheme);paintTheme();
let view='all',results=[],shown=0,matchList=null;const PAGE=40;
function setView(v){
  view=v;$('tabAll').setAttribute('aria-pressed',v==='all');$('tabMatch').setAttribute('aria-pressed',v==='match');$('tabApps').setAttribute('aria-pressed',v==='apps');$('tabInbox').setAttribute('aria-pressed',v==='inbox');
  $('sortWrap').hidden=v!=='all';$('elsewhere').hidden=v!=='all';render();
}
function run(){read();setView('all')}
/* No results: loosen the search one step at a time and show the first version that finds something */
function _lev(a,b){const d=Array.from({length:a.length+1},(_,i)=>[i]);for(let j=1;j<=b.length;j++)d[0][j]=j;
  for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return d[a.length][b.length]}
let _cos=null;
function suggest(){
  const saved=JSON.stringify(state),restore=()=>{delete state._any;Object.assign(state,JSON.parse(saved));_kwqFor=null};
  const sortRel=a=>a.sort((x,y)=>((y.rel||0)-(x.rel||0))||(y.rt-x.rt)*0.6+(y.t-x.t)/864000);
  const tryIt=(why,change)=>{change();_kwqFor=null;const l=L.filter(matches);restore();return l.length?{why,list:sortRel(l)}:null};
  const term=[state.season,state.year].filter(Boolean).join(' ');
  const q=state.kw?KWQ():{states:[],remote:false,words:[]};
  const side=['usonly','remote','known','f500'].filter(k=>state[k]).length||state.loc||state.deg.length;
  const steps=[];
  // a misspelled company name: "nvida" -> NVIDIA
  if(q.words.length){_cos=_cos||[...new Set(L.map(x=>x.co))];
    const fixed=q.words.map(w=>{if(w.length<4||L.some(x=>x.hay.includes(w)))return w;
      let best=null,bd=9;for(const c of _cos){for(const t of c.toLowerCase().split(/\s+/)){const dd=_lev(w,t);if(dd<bd){bd=dd;best=t}}}
      return bd<=Math.max(1,Math.floor(w.length/4))?best:w});
    if(fixed.join(' ')!==q.words.join(' ')){const kw2=state.kw.toLowerCase().replace(new RegExp(q.words.map(w=>w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'g'),m=>fixed[q.words.indexOf(m)]);
      steps.push([`for “${kw2}”`,()=>{state.kw=kw2}])}}
  if(term)steps.push([`for any season (nothing for ${term})`,()=>{state.season='';state.year=''}]);
  if(side)steps.push(['without your sidebar filters',()=>{state.usonly=state.remote=state.known=state.f500=false;state.loc='';state.deg=[]}]);
  if(q.states.length)steps.push([`for “${q.words.join(' ')}” in any location`,()=>{state.kw=q.words.join(' ')}]);
  if(q.states.length&&term)steps.push([`for “${q.words.join(' ')}” in any location and any season`,()=>{state.kw=q.words.join(' ');state.season='';state.year=''}]);
  if(q.words.length>1)steps.push([`matching some of your words (“${q.words.join('”, “')}”)`,()=>{state.kw='';state._any=q.words}]);
  if(state.kw&&(state.major||state.field))steps.push([`for “${state.kw}” in every field`,()=>{state.major='';state.field=''}]);
  if(state.kw&&(state.major||state.field)&&term)steps.push([`for “${state.kw}” in every field and season`,()=>{state.major='';state.field='';state.season='';state.year=''}]);
  for(const [why,ch] of steps){const r=tryIt(why,ch);if(r)return r}
  return null;
}
function render(){
  shown=0;$('list').innerHTML='';
  if(view==='apps'){renderApps();return}
  if(view==='inbox'){renderInbox();return}
  if(view==='match'&&matchList){
    $('count').innerHTML=`<b>${matchList.length}</b> best matches for your resume`;
    $('list').innerHTML=matchList.map(m=>card(L[m.id],m)).join('');$('more').hidden=true;return;
  }
  results=L.filter(matches);
  if(state.sort==='rel')results.sort((a,b)=>((b.rel||0)-(a.rel||0))||(b.rt-a.rt)*0.6+(b.t-a.t)/864000);else if(state.sort==='co')results.sort((a,b)=>a.co.localeCompare(b.co)||b.t-a.t);else if(state.sort==='rt')results.sort((a,b)=>b.rt-a.rt||b.t-a.t);else results.sort((a,b)=>b.t-a.t);
  const what=[state.field?CAT[state.field]:state.major?state.major+' ('+MAJ[state.major].f.map(c=>CAT[c]).join(', ')+')':'All fields',[state.season,state.year].filter(Boolean).join(' ')||'any term'].join(' · ');
  $('count').innerHTML=(newOnly?`<b>${results.length.toLocaleString()}</b> new${f5New?' Fortune 500 jobs':''} since the last update <button type="button" class="chip" id="newOff">Show all jobs ×</button>`:`<b>${results.length.toLocaleString()}</b> internships · ${esc(what)}${state.kw?' · “'+esc(state.kw)+'”':''}`);
  if(!results.length&&!newOnly){const sg=suggest();
    if(sg){results=sg.list;$('list').innerHTML=`<div class="suggest"><b>No exact matches.</b> Suggested results ${esc(sg.why)}:</div>`}
    else $('list').innerHTML='<div class="empty">No open listings match. Try a different season or year, a broader field, or clear the keywords.</div>'}
  page();elsewhere();
  syncFieldChips();syncStudy();renderQuick();renderNewPill();renderF500();
}
const KW={Software:'software engineering',"AI/ML/Data":'data science machine learning',Hardware:'electrical computer engineering',Mechanical:'mechanical aerospace engineering',Engineering:'civil industrial engineering',IT:'IT cybersecurity',Product:'product design UX',
 Finance:'finance accounting',Quant:'quantitative trading',Consulting:'consulting',Business:'business operations supply chain',Marketing:'marketing',Sales:'sales',HR:'human resources',RealEstate:'real estate',Retail:'retail merchandising fashion',
 Hospitality:'hospitality hotel',Healthcare:'healthcare administration',Science:'biology chemistry research',Media:'media entertainment journalism',Sports:'sports',Legal:'law policy government',Nonprofit:'nonprofit',Environment:'environmental sustainability',Music:'music industry',Arts:'museum art gallery theatre',Marine:'marine biology ocean science',Education:'education teaching'};
const NICHE={Hospitality:[['Hcareers','hcareers.com'],['Hospitality Online','hospitalityonline.com']],Sports:[['TeamWork Online','teamworkonline.com']],Nonprofit:[['Idealist','idealist.org']],Legal:[['USAJOBS','usajobs.gov']],
 Media:[['EntertainmentCareers','entertainmentcareers.net'],['Mediabistro','mediabistro.com']],Environment:[['Environmental Career Center','environmentalcareer.com']],Healthcare:[['Health eCareers','healthecareers.com']],Science:[['Nature Careers','nature.com/naturecareers']],
 Product:[['Dribbble Jobs','dribbble.com/jobs']],Finance:[['eFinancialCareers','efinancialcareers.com']],RealEstate:[['SelectLeaders','selectleaders.com']],Retail:[['Fashionista Jobs','fashionista.com']],Music:[['Music Industry Jobs (EntertainmentCareers)','entertainmentcareers.net'],['Indeed music internships','indeed.com']],Arts:[['Artsearch','artsearch.us'],['AAM JobHQ','aam-us.org'],['Archinect Jobs','archinect.com/jobs']],Marine:[['NOAA','noaa.gov'],['Texas A&M Job Board','wfscjobs.tamu.edu']],Education:[['Idealist','idealist.org'],['K12JobSpot','k12jobspot.com']]};
function elsewhere(){
  const term=[state.season,state.year].filter(Boolean).join(' ');
  const mk=state.major&&!state.field?state.major.replace(/\(.*?\)/g,'').split('/')[0].trim():'';
  const base=[state.kw||KW[state.field]||mk||'',' intern'].join('').trim();
  const q=(base+(term?' '+term:'')).trim();
  const e=encodeURIComponent;
  const links=[
    ['Handshake','https://app.joinhandshake.com/'],
    ['LinkedIn',`https://www.linkedin.com/jobs/search/?keywords=${e(base)}&f_E=1`],
    ['Indeed',`https://www.indeed.com/jobs?q=${e(q)}`],
    ['Google Jobs',`https://www.google.com/search?q=${e(q+' internship')}&ibp=htl;jobs`],
    ['Glassdoor',`https://www.glassdoor.com/Job/jobs.htm?sc.keyword=${e(base)}`],
    ['ZipRecruiter',`https://www.ziprecruiter.com/jobs-search?search=${e(q)}`],
    ...(NICHE[state.field]||(state.major&&MAJ[state.major]?NICHE[MAJ[state.major].f[0]]:null)||[]).map(([n,d])=>[n,`https://www.google.com/search?q=${e('site:'+d+' '+q)}`]),
  ];
  $('ewText').textContent=`No single site has every internship. These open "${q}" on the biggest job boards${NICHE[state.field]?' and boards for this field':''}. Handshake needs your school login.`;
  $('ewLinks').innerHTML=links.map(([n,u])=>`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(n)} ↗</a>`).join('');
}
function page(){
  $('list').insertAdjacentHTML('beforeend',results.slice(shown,shown+PAGE).map(x=>card(x)).join(''));
  shown+=PAGE;$('more').hidden=shown>=results.length;
  if(!$('more').hidden)$('more').textContent=`Show more (${(results.length-shown).toLocaleString()} left)`;
}
function showResults(){
  const l=$('list');l.classList.remove('anim');void l.offsetWidth;l.classList.add('anim');
  const s=$('count');s.classList.remove('flash');void s.offsetWidth;s.classList.add('flash');
  const top=$('resultsTop').getBoundingClientRect().top+window.scrollY-12;
  window.scrollTo({top,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
}
let searching=false;
$('search').addEventListener('submit',e=>{e.preventDefault();if(searching)return;
  const b=$('search').querySelector('.go .btn');comboClose();
  const quick=matchMedia('(prefers-reduced-motion: reduce)').matches;
  searching=true;b.classList.add('busy');b.setAttribute('aria-label','Searching');
  b.innerHTML='<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>';
  setTimeout(()=>{run();showResults();b.classList.remove('busy');b.textContent='Search';b.removeAttribute('aria-label');searching=false},quick?150:750);
});
['season','year','sort','remote','usonly','nocit','paidonly','known','f500','loc',...DEG.map((d,i)=>'deg'+i)].forEach(id=>$(id).addEventListener('change',run));
$('more').addEventListener('click',page);
$('major').addEventListener('change',()=>{$('field').value='';run()});
$('field').addEventListener('change',()=>{if($('field').value)$('major').value='';run()});
$('tabAll').addEventListener('click',()=>setView('all'));
$('tabMatch').addEventListener('click',()=>setView('match'));
$('tabApps').addEventListener('click',()=>setView('apps'));
$('tabInbox').addEventListener('click',()=>setView('inbox'));

/* ---------- Inbox: recruiting emails from Gmail, matched to tracked applications ---------- */
let gmail=null,INBOX=null,inboxState='idle',inboxErr='';
const ATS='(greenhouse.io OR myworkday OR myworkdayjobs.com OR lever.co OR ashbyhq.com OR icims.com OR smartrecruiters.com OR successfactors OR taleo.net OR eightfold.ai OR jobvite.com OR workablemail.com OR hire.lever.co OR us.greenhouse-mail.io)';
const SIGNALS=[
  ['Offer',/\b(offer letter|pleased to offer|extend (you )?an offer|congratulations[^.]{0,40}offer)\b/i],
  ['Rejected',/(not (be )?moving forward|move forward with other|other candidates|not been selected|decided not to (move|proceed|pursue)|will not be proceeding|position has been filled|regret to inform|unfortunately[^.]{0,120}(application|candida|position|role|opportunit))/i],
  ['Interviewing',/\b(interview|phone screen|next round|superday|schedule (a|an|your) (call|chat|interview|time to (talk|speak|chat)))\b/i],
  ['Online assessment',/\b(assessment|hackerrank|codesignal|coding challenge|online test|hirevue|pymetrics|take-home)\b/i],
  ['Received',/(thank you for (applying|your application|your interest)|application (has been )?received|we('ve| have) received your application|application submitted|confirm(ing)? (receipt|your application))/i],
];
// What counts as a real hiring email (vs. job-alert digests, newsletters, bank or insurance mail)
const ATSRE=/greenhouse|workday|lever\.co|ashbyhq|icims|smartrecruiters|successfactors|taleo|eightfold|jobvite|workable|avature|phenom|brassring|paradox\.ai|oraclecloud|hirevue|codesignal|hackerrank|myworkday|recruit/i;
const ALERTFROM=/glassdoor|indeed|ziprecruiter|linkedin|monster|careerbuilder|simplyhired|dice\.com|talent\.com|jooble|lensa|wellfound|builtin/i;
const JUNK=/\b(job alerts?|jobs? (for|matching) you|recommended (jobs|for you)|more jobs in|is hiring\b|apply now|unsubscribe from (this|these) (alerts?|emails?)|paid sponsor|sponsored|newsletter|webinar|card account|account ending|statement|payment (due|received)|premium|policy|coverage|life offer|rewards|% off|limited time|deal|discount)\b/i;
const HIREWORDS=/\b(your application|thank you for applying|thanks for applying|you applied|application (status|update|received)|candida(te|cy)|requisition|hiring team|recruiter|recruiting team|interview|assessment|offer letter|next steps)\b/i;
function senderText(s){return (s||'').toLowerCase()}
const ORDER={Applied:0,Received:0,'Online assessment':1,Interviewing:2,Offer:3,Rejected:3,Withdrew:3};
function decode(t){const d=document.createElement('textarea');d.innerHTML=t||'';return d.value.replace(/[\u034f\u200c\u00a0]+/g,' ').replace(/\s+/g,' ').trim()}
function signalOf(text){for(const [n,re] of SIGNALS)if(re.test(text))return n;return ''}
function coKey(co){const w=co.replace(/\(.*?\)/g,'').split(/[\s,.&]+/).filter(x=>x.length>=3&&!STOP.has(x.toLowerCase()));return (w[0]||co).toLowerCase()}
function qName(co){return '"'+co.replace(/\(.*?\)/g,'').replace(/["()]/g,'').replace(/,? (Inc|LLC|Corporation|Corp|Co)\.?$/i,'').trim()+'"'}
async function gCall(tool,input){return gmail[tool](input)}
async function loadInbox(){
  if(!gmail)return;
  inboxState='loading';inboxErr='';renderInbox();
  try{
    const apps=Object.entries(APPS);
    const names=[...new Set(apps.map(([k,a])=>a.co).filter(Boolean))];
    const queries=[`newer_than:120d -category:promotions -category:social -category:forums from:${ATS}`];
    for(let i=0;i<names.length;i+=8){
      queries.push(`newer_than:120d -category:promotions -category:social {${names.slice(i,i+8).map(qName).join(' ')}} ("your application" OR "for applying" OR interview OR assessment OR candidate OR "next steps" OR "offer letter")`);
    }
    const seen=new Map();
    for(const q of queries.slice(0,8)){
      const p=await gCall('search_threads',{query:q,pageSize:30,view:'THREAD_VIEW_MINIMAL'});
      for(const t of (p.threads||[]))if(!seen.has(t.id))seen.set(t.id,t);
    }
    // Gmail groups same-subject emails into one conversation (e.g. eight "Thank you for applying" emails from Amazon),
    // so look at every message, work out which job it's about, then keep one entry per job.
    const TSTOP=new Set(['intern','interns','internship','summer','fall','spring','winter','2025','2026','2027','2028','the','and','for','with','usa','program','co-op','coop','undergraduate','graduate','student','team']);
    const toks=s=>new Set((s||'').toLowerCase().replace(/\(id:?\s*\d+\)/g,' ').split(/[^a-z0-9+#]+/).filter(w=>w.length>=3&&!TSTOP.has(w)));
    const emailTitle=s=>{
      const re=/(?:application|applying|interest|applied)\s+(?:to|for|in)\s+(?:the\s+)?(?:position of\s+)?(.{6,140}?)(?:\s*\(ID:?\s*\d+\))?\s*(?:position|role|job|opening|at\s+[A-Z]|[.!,]|$)/gi;
      for(const m of (s||'').matchAll(re)){const ti=m[1].trim();
        if(ti.length>=8&&!/^(us|our|the company|this|your|amazon|google|meta|apple)\b/i.test(ti)&&/[a-z]{3,}\s+[a-z]{3,}/i.test(ti))return ti}
      return ''};
    const jobIds=s=>new Set((s||'').match(/\b\d{6,}\b/g)||[]);
    const fit=(a,et,ids)=>{let sc=0;for(const id of ids)if((a.url||'').includes(id))sc+=100;
      const aIds=(a.url||'').match(/\d{6,}/g)||[];if(!sc&&ids.size&&aIds.length)return -1;   // both have job numbers and they differ: different job
      const at=toks(a.title),e=toks(et);if(at.size&&e.size){let n=0;for(const w of at)if(e.has(w))n++;sc+=n/Math.max(at.size,e.size)}return sc};
    const groups=new Map();
    for(const th of seen.values()){
      for(const m of (th.messages||[])){
        const text=decode((m.subject||'')+' '+(m.snippet||''));
        const from=senderText(m.sender),sig=signalOf(text);
        const hiring=!!sig||HIREWORDS.test(text);
        if(((JUNK.test(text)||ALERTFROM.test(from))&&!sig)||!hiring)continue;
        const fromAts=ATSRE.test(from);
        const cands=apps.filter(([k,a])=>{const ck=coKey(a.co||'');return ck&&(from.includes(ck)||(fromAts&&text.toLowerCase().includes(ck)))});
        if(!cands.length&&!fromAts&&!sig)continue;
        const et=emailTitle(m.snippet)||emailTitle(m.subject),ids=jobIds(text);
        let match=null,co=cands.length?cands[0][1].co:'';
        if(cands.length){
          const best=cands.map(([k,a])=>[k,fit(a,et,ids)]).sort((x,y)=>y[1]-x[1])[0];
          if(best[1]>=100||best[1]>=0.5||(!et&&cands.length===1))match=best[0];   // job ID or most of the title matches
        }
        const key=match||(co?co.toLowerCase()+'|'+(et.toLowerCase()||'?'):'t|'+th.id+'|'+(m.subject||''));
        const it={id:th.id,url:th.viewUrl,subject:decode(m.subject||'(no subject)'),from:m.sender||'',date:m.date||'',snippet:decode(m.snippet||''),
          signal:sig,match,co:match?'':co,emailTitle:et,count:1};
        const g=groups.get(key);
        if(!g){groups.set(key,it);continue}
        g.count++;
        const rank=s=>s?ORDER[s]+1:0;
        if(rank(sig)>rank(g.signal)||(rank(sig)===rank(g.signal)&&(it.date||'')>(g.date||''))){it.count=g.count;groups.set(key,it)}
      }
    }
    const items=[...groups.values()];
    items.sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    INBOX=items;inboxState='ok';
  }catch(e){
    inboxState='error';
    inboxErr={needs_reauth:'Google sign-in was closed or expired. Press Check my email and allow read-only access.',
      server_not_connected:'Gmail is not set up on this site.',
      not_in_manifest:'Gmail access was turned off for this page. Allow it from the page\'s connector prompt to use the inbox.',
      blocked_by_policy:'Your organization blocks Gmail for this page.',
      server_unavailable:'Gmail did not respond. Try again in a minute.',
      tool_error:'Gmail returned an error: '+(e&&e.message||'')}[e&&e.code]||'Could not check your email. Try again.';
  }
  if(view==='inbox')renderInbox();
}
function renderInbox(){
  $('more').hidden=true;
  const btn=`<button type="button" class="copy" id="inboxRefresh">${INBOX?'Check again':'Check my email'}</button>`;
  if(typeof inboxGate==='function'){const g=inboxGate();if(g){$('count').innerHTML='Inbox';$('list').innerHTML=g;return}}
  if(!gmail){$('count').innerHTML='Inbox';$('list').innerHTML='<div class="empty">The inbox is off on this site.</div>';return}
  if(inboxState==='loading'){$('count').innerHTML='Inbox · checking Gmail…';$('list').innerHTML='<div class="empty">Searching your email for recruiting messages…</div>';return}
  if(inboxState==='error'){$('count').innerHTML='Inbox';$('list').innerHTML=`<div class="empty">${esc(inboxErr)}<br><br>${btn}</div>`;return}
  if(!INBOX){$('count').innerHTML='Inbox';$('list').innerHTML=`${typeof inboxBar==='function'?inboxBar():''}<div class="empty">Find replies from companies you applied to. Sign in with Google and this searches your Gmail (read-only) for recruiting emails from the last 4 months and matches them to <b>My applications</b>. Nothing from your email leaves your browser.<br><br>${btn}</div>`;return}
  const matched=INBOX.filter(i=>i.match||i.co),other=INBOX.filter(i=>!i.match&&!i.co);
  $('count').innerHTML=`<b>${INBOX.length}</b> recruiting email${INBOX.length===1?'':'s'} · ${matched.length} matched to your applications`;
  const row=i=>{
    const a=i.match&&APPS[i.match];
    const sugg=a&&i.signal&&i.signal!=='Received'&&i.signal!==a.status&&(ORDER[i.signal]>=ORDER[a.status]||i.signal==='Rejected');
    const sig=i.signal?`<span class="tag ${i.signal==='Rejected'?'warn':i.signal==='Received'?'':'good'}">${esc(i.signal==='Received'?'Application received':i.signal)}</span>`:'';
    return `<div class="mail">
      <div class="mail-top"><b>${esc(a?a.co:i.co||i.from.replace(/<.*>/,'').trim())}</b>${a?`<span class="tag term">${esc(a.title)}</span>`:i.emailTitle?`<span class="tag">${esc(i.emailTitle)}</span>`:''}${!a&&i.co?'<span class="tag warn">Not in My applications</span>':''}${sig}<span class="mail-date">${i.date?new Date(i.date).toLocaleDateString(undefined,{month:'short',day:'numeric'}):''}</span></div>
      <div class="mail-subj">${esc(i.subject)}${i.count>1?` <span class="mail-n">(${i.count} emails)</span>`:''}</div>
      <div class="mail-snip">${esc(i.snippet.slice(0,220))}</div>
      <div class="mail-act"><a href="${esc(i.url)}" target="_blank" rel="noopener">Open in Gmail ↗</a>
        ${sugg?`<button type="button" class="copy mail-apply" data-key="${i.match}" data-status="${esc(i.signal)}">Set status to ${esc(i.signal)}</button>`:a?`<span class="mail-cur">Status: ${esc(a.status)}</span>`:''}</div>
    </div>`};
  $('list').innerHTML=`${typeof inboxBar==='function'?inboxBar():''}<div class="inbox-bar">${btn}<span>Statuses are guessed from the email text, so open the email to be sure. You choose whether to update.</span></div>`
    +(matched.length?`<h3 class="ib-h">Replies to your applications</h3>${matched.map(row).join('')}`:'<div class="empty">No replies matched to your tracked applications yet.</div>')
    +(other.length?`<h3 class="ib-h">Other recruiting emails</h3>${other.slice(0,40).map(row).join('')}`:'');
}
$('list').addEventListener('click',e=>{
  if(e.target.closest('#inboxRefresh')){loadInbox();return}
  const b=e.target.closest('.mail-apply');if(!b||!tdb)return;
  b.disabled=true;
  tdb.collection('data/users/'+tuid).doc(b.dataset.key).update({status:b.dataset.status,updatedAt:Date.now()})
    .then(()=>{b.textContent='Updated';if(view==='inbox')setTimeout(renderInbox,400)})
    .catch(()=>{b.disabled=false;b.textContent='Could not update. Try again'});
});
gmail=GmailApi;if(gmail)$('tabInbox').hidden=false;

/* ---------- Application tracker (saved privately per person) ---------- */
const STATUSES=['Applied','Online assessment','Interviewing','Offer','Rejected','Withdrew'];
const STCLS={Applied:'term',"Online assessment":'term',Interviewing:'good',Offer:'good',Rejected:'warn',Withdrew:''};
let tdb=null,tuid=null,APPS={},trackOK=false;
const BYURL={};L.forEach(x=>{BYURL[x.url]=x});
function appKey(url){let h=5381;for(const c of url)h=((h*33)^c.charCodeAt(0))>>>0;let h2=0;for(const c of url)h2=(h2*131+c.charCodeAt(0))>>>0;return 'app-'+h.toString(36)+h2.toString(36)}
function trackTag(url){const a=APPS[appKey(url)];return a?`<span class="tag ${STCLS[a.status]||''} applied">✓ ${esc(a.status)}</span>`:''}
function trackCtl(url){
  if(!trackOK)return '';
  const a=APPS[appKey(url)];
  if(!a)return '<button type="button" class="copy tk-add">Mark as applied</button>';
  return `<label class="tk-row">Status <select class="tk-status">${STATUSES.map(st=>`<option${st===a.status?' selected':''}>${esc(st)}</option>`).join('')}</select></label>
    <span class="tk-date">Applied ${new Date(a.appliedAt).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</span>
    <button type="button" class="tk-rm">Remove</button>`;
}
function refreshTracked(){
  const n=Object.keys(APPS).length;$('tabApps').textContent=n?`My applications (${n})`:'My applications';
  document.querySelectorAll('[data-tracktag]').forEach(el=>{const x=el.closest('.item');const url=x&&x.querySelector('[data-track]')?.dataset.url;if(url)el.innerHTML=trackTag(url)});
  document.querySelectorAll('[data-track]').forEach(el=>{if(!el.contains(document.activeElement)||el.dataset.busy)el.innerHTML=trackCtl(el.dataset.url)});
  if(view==='apps')renderApps();
}
/* ---------- Past applications: read "thanks for applying" emails and match them to Intern Finder listings ---------- */
let PAST=null,pastState='idle',pastErr='';
const PAST_Q=['newer_than:300d -category:promotions -category:social ("thank you for applying" OR "thanks for applying" OR "application received" OR "received your application" OR "your application to" OR "your application for" OR "application submitted" OR "thank you for your application")',
  `newer_than:300d -category:promotions -category:social from:${ATS}`];
const SENDER_JUNK=/\b(careers?|jobs?|recruit(ing|ment|er|ers)?|talent( acquisition)?|team|hiring|hr|people|university|campus|early careers?|notifications?|no-?reply|do-?not-?reply|via|workday|greenhouse|lever|ashby|icims|smartrecruiters|successfactors|taleo|jobvite|workable|the|at|@)\b/gi;
let _coIdx=null;
const MAILWORDS=new Set(['noreply','reply','jobs','job','careers','career','talent','recruiting','recruitment','recruiter','mail','email','notifications','notification','team','apply','hire','hiring','workday','myworkday','myworkdayjobs','greenhouse','lever','ashbyhq','icims','smartrecruiters','successfactors','taleo','jobvite','workablemail','gmail','outlook','info','support','people','university','campus','your','our','this','thank','thanks','application','applications','candidate','candidates','interview','position','role','next','steps','update','summer','fall','spring','internship','intern','mail01','email01','us','hr','greenhouse-mail','eightfold','phenom','avature','oraclecloud','dayforce','paradox','hirevue','codesignal','hackerrank']);
function coIndex(){
  if(_coIdx)return _coIdx;
  const byKey=new Map(),byDom=new Map();
  for(const x of L){const k=coKey(x.co);if(k&&k.length>=3){if(!byKey.has(k))byKey.set(k,[]);byKey.get(k).push(x)}}
  for(const [co,dom] of Object.entries(window.DOMAINS||{}))byDom.set(dom.split('.')[0].toLowerCase(),coKey(co));
  return _coIdx={byKey,byDom};
}
function companyOf(from,text){
  const {byKey,byDom}=coIndex();const tries=[];
  const name=(from.match(/^\s*"?([^"<]+?)"?\s*</)||[])[1]||'';
  const addr=((from.match(/<([^>]+)>/)||[])[1]||from).toLowerCase();
  const [local,host]=addr.split('@');
  tries.push(coKey(name.replace(SENDER_JUNK,' ').replace(/\s+/g,' ').trim()||'-'));
  if(host){const parts=host.split('.');for(const p of parts)tries.push(byDom.get(p)||p)}
  if(local)tries.push(...local.split(/[^a-z0-9]+/));
  for(const m of text.matchAll(/\b(?:at|to|with|join(?:ing)?|from)\s+(?:the\s+)?([A-Z][A-Za-z0-9&.'-]+(?:\s+[A-Z][A-Za-z0-9&.'-]+){0,3})/g))tries.push(coKey(m[1]));
  for(const t of tries){if(t&&t.length>=3&&!MAILWORDS.has(t)&&byKey.has(t))return t}
  return '';
}
async function scanPast(){
  if(!gmail)return;
  pastState='loading';pastErr='';if(view==='apps')renderApps();
  try{
    const seen=new Map();
    for(const q of PAST_Q){const p=await gCall('search_threads',{query:q,pageSize:50});for(const t of (p.threads||[]))if(!seen.has(t.id))seen.set(t.id,t)}
    const TSTOP=new Set(['intern','interns','internship','summer','fall','spring','winter','2025','2026','2027','2028','the','and','for','with','usa','program','co-op','coop','undergraduate','graduate','student','team']);
    const toks=t=>new Set((t||'').toLowerCase().split(/[^a-z0-9+#]+/).filter(w=>w.length>=3&&!TSTOP.has(w)));
    const titleIn=t=>{const re=/(?:application|applying|interest|applied)\s+(?:to|for|in)\s+(?:the\s+)?(?:position of\s+)?(.{6,140}?)(?:\s*\(ID:?\s*\d+\))?\s*(?:position|role|job|opening|at\s+[A-Z]|[.!,]|$)/gi;
      for(const m of (t||'').matchAll(re)){const ti=m[1].trim();if(ti.length>=8&&/[a-z]{3,}\s+[a-z]{3,}/i.test(ti)&&!/^(us|our|this|your)\b/i.test(ti))return ti}return ''};
    const out=new Map();const rank=x=>x?ORDER[x]+1:0;
    for(const th of seen.values())for(const m of (th.messages||[])){
      const text=decode((m.subject||'')+' '+(m.snippet||''));const from=m.sender||'';
      const sig=signalOf(text);
      if(!sig&&!HIREWORDS.test(text))continue;
      if((JUNK.test(text)||ALERTFROM.test(from.toLowerCase()))&&!sig)continue;
      const ck=companyOf(from,text);if(!ck)continue;
      const et=titleIn(m.snippet)||titleIn(m.subject)||'';const ids=new Set(text.match(/\b\d{6,}\b/g)||[]);
      // best listing at that company: same job number, else most of the title words in common
      let best=null,bs=0;
      for(const x of coIndex().byKey.get(ck)){let sc=0;for(const id of ids)if(x.url.includes(id))sc=100;
        if(!sc&&et){const a=toks(x.title),e=toks(et);let n=0;for(const w of a)if(e.has(w))n++;sc=a.size&&e.size?n/Math.max(a.size,e.size):0}
        if(sc>bs){bs=sc;best=x}}
      const job=bs>=0.6?best:null;
      const co=job?job.co:coIndex().byKey.get(ck)[0].co;
      const key=job?job.url:co.toLowerCase()+'|'+(et||m.subject||'').toLowerCase();
      if(APPS[appKey(job?job.url:th.viewUrl)])continue;                 // already tracked
      const status=sig&&sig!=='Received'?sig:'Applied';
      const it={key,job,co,title:job?job.title:(et||decode(m.subject||'')),status,date:m.date||'',mail:th.viewUrl,subject:decode(m.subject||'')};
      const g=out.get(key);
      if(!g||rank(status)>rank(g.status))out.set(key,{...it,date:g&&g.date>it.date?g.date:it.date});
    }
    PAST=[...out.values()].sort((a,b)=>(!!b.job-!!a.job)||(b.date||'').localeCompare(a.date||''));pastState='ok';
  }catch(e){pastState='error';pastErr=e&&e.code==='needs_reauth'?'Google sign-in was closed or expired. Try again and allow read-only access.':'Could not check your email. Try again.'}
  if(view==='apps')renderApps();
}
function pastBlock(){
  if(!gmail)return '';
  if(typeof inboxGate==='function'&&inboxGate())return `<div class="past-bar"><span><b>Applied to places before you found Intern Finder?</b> Sign in and connect Gmail, and we'll find those applications in your email.</span><button type="button" class="copy" id="inboxSignIn">Sign in</button></div>`;
  if(pastState==='loading')return '<div class="past-bar"><span>Looking through your email for applications you already sent…</span></div>';
  if(pastState==='error')return `<div class="past-bar"><span>${esc(pastErr)}</span><button type="button" class="copy" id="pastScan">Try again</button></div>`;
  if(!PAST)return `<div class="past-bar"><span><b>Applied to places before you found Intern Finder?</b> We can read your "thanks for applying" emails (read-only, it stays in your browser) and match them to listings here.</span><button type="button" class="copy" id="pastScan">Find them in my email</button></div>`;
  const left=PAST.filter(p=>!APPS[appKey(p.job?p.job.url:p.mail)]);
  if(!left.length)return `<div class="past-bar"><span>${PAST.length?'Everything we found in your email is in your list.':'No past applications found in your email.'}</span><button type="button" class="copy" id="pastScan">Check again</button></div>`;
  const row=p=>{const i=PAST.indexOf(p);
    const when=p.date?' · '+new Date(p.date).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'';
    const st=`<span class="tag ${p.status==='Rejected'?'warn':p.status==='Applied'?'term':'good'}">${esc(p.status==='Applied'?'Application received':p.status)}</span>`;
    const bar=`<div class="past-meta">${st}<span>From your email${when} · <a href="${esc(p.mail)}" target="_blank" rel="noopener">open email ↗</a></span><button type="button" class="copy past-add" data-i="${i}">Add to My applications</button></div>`;
    if(p.job)return `<div class="past-item">${bar}${card(p.job)}</div>`;
    return `<div class="past-item">${bar}<div class="item"><div class="sumlike">${logo(p.co)}<span class="body"><span class="coline"><span class="cn">${esc(p.co)}</span></span>
      <span class="title">${esc(p.title)}</span><span class="facts"><span>This exact posting isn't on Intern Finder</span></span></span></div></div></div>`};
  const m=left.filter(p=>p.job),o=left.filter(p=>!p.job);
  return `<div class="past-head"><b>Found in your email (${left.length})</b><span>Applications you sent before using Intern Finder. Add the ones that are right.</span>
      <button type="button" class="copy" id="pastAll">Add all ${left.length}</button></div>
    ${m.map(row).join('')}${o.length?`<div class="past-sub">Not on Intern Finder (added with a link to the email)</div>${o.map(row).join('')}`:''}
    ${apps_divider()}`;
}
function apps_divider(){return Object.keys(APPS).length?'<div class="past-sub">Your tracked applications</div>':''}
function addPast(p){
  const url=p.job?p.job.url:p.mail,x=p.job||{};
  const ts=p.date?Date.parse(p.date)||Date.now():Date.now();
  return tdb.collection('data/users/'+tuid).doc(appKey(url)).set({kind:'app',url,co:p.co,title:p.title,loc:(x.locs||[])[0]||'',status:p.status,
    appliedAt:ts,updatedAt:Date.now(),...(p.job?{}:{source:'email'})});
}
$('list').addEventListener('click',async e=>{
  if(e.target.closest('#pastScan')){scanPast();return}
  const one=e.target.closest('.past-add'),all=e.target.closest('#pastAll');if(!(one||all)||!tdb||!PAST)return;
  const btn=one||all;btn.disabled=true;btn.textContent='Adding…';
  try{
    const list=one?[PAST[+one.dataset.i]]:PAST.filter(p=>!APPS[appKey(p.job?p.job.url:p.mail)]);
    for(const p of list)await addPast(p);
  }catch(err){btn.disabled=false;btn.textContent='Could not add. Try again';return}
  if(view==='apps')setTimeout(renderApps,300);
});
function renderApps(){
  const apps=Object.entries(APPS).sort((a,b)=>(b[1].updatedAt||0)-(a[1].updatedAt||0));
  const counts={};apps.forEach(([k,a])=>counts[a.status]=(counts[a.status]||0)+1);
  $('count').innerHTML=`<b>${apps.length}</b> application${apps.length===1?'':'s'}`+(apps.length?' · '+STATUSES.filter(s=>counts[s]).map(s=>`${counts[s]} ${esc(s.toLowerCase())}`).join(' · '):'');
  $('more').hidden=true;
  const found=pastBlock();
  if(!apps.length){$('list').innerHTML=found+'<div class="empty">No applications tracked yet. Open any listing and press <b>Mark as applied</b> after you apply.</div>';return}
  $('list').innerHTML=found+apps.map(([k,a])=>{
    const x=BYURL[a.url];
    if(x)return card(x);
    return `<div class="item gone"><div class="ticket" style="border:0">
      <div class="gone"><div class="title">${esc(a.title||'Internship')}</div><div class="co">${esc(a.co||'')} · ${a.source==='email'?'added from your email (this exact posting isn\'t on Intern Finder)':'this posting is no longer in the list (it may have closed)'}</div></div>
      <div class="cta"><a class="apply" href="${esc(a.url)}" target="_blank" rel="noopener">${a.source==='email'?'Open email ↗':'Open posting ↗'}</a>
      <div class="track" data-track="${k}" data-url="${esc(a.url)}">${trackCtl(a.url)}</div></div></div></div>`;
  }).join('');
}
async function tWrite(el,fn){
  if(el.dataset.busy)return;el.dataset.busy='1';el.querySelectorAll('button,select').forEach(b=>b.disabled=true);
  try{await fn()}catch(e){
    const msg=e&&e.code==='quota_exceeded'?'Storage is full. Remove some old applications.':'Could not save. Try again.';
    el.insertAdjacentHTML('beforeend',`<span class="tk-err">${msg}</span>`);
  }finally{delete el.dataset.busy;el.querySelectorAll('button,select').forEach(b=>b.disabled=false)}
}
$('list').addEventListener('click',e=>{
  const el=e.target.closest('[data-track]');if(!el||!tdb)return;
  const url=el.dataset.url,key=appKey(url),ref=tdb.collection('data/users/'+tuid).doc(key);
  if(e.target.closest('.tk-add')){const x=BYURL[url]||{};
    tWrite(el,()=>ref.set({kind:'app',url,co:x.co||'',title:x.title||'',loc:(x.locs||[])[0]||'',status:'Applied',appliedAt:Date.now(),updatedAt:Date.now()}));}
  else if(e.target.closest('.tk-rm'))tWrite(el,()=>ref.delete());
});
$('list').addEventListener('change',e=>{
  const sel=e.target.closest('.tk-status');if(!sel||!tdb)return;const el=sel.closest('[data-track]');
  const ref=tdb.collection('data/users/'+tuid).doc(appKey(el.dataset.url));
  tWrite(el,()=>ref.update({status:sel.value,updatedAt:Date.now()}));
});
(async()=>{
  try{
    const d=Store;tuid='me';
    tdb=d;trackOK=true;$('tabApps').hidden=false;
    tdb.collection('data/users/'+tuid).where('kind','==','app').onSnapshot(snap=>{
      const next={};snap.docs.forEach(doc=>{next[doc.id]=doc.data()});APPS=next;refreshTracked();
    },()=>{trackOK=false;refreshTracked()});
    refreshTracked();
  }catch(e){}
})();
$('fieldChips').addEventListener('click',e=>{const b=e.target.closest('.chip');if(!b)return;
  $('field').value=b.getAttribute('aria-pressed')==='true'?'':b.dataset.f;$('major').value='';run();showResults()});
$('coStrip').addEventListener('click',e=>{const b=e.target.closest('.cotile');if(!b)return;
  $('kw').value=b.dataset.co;$('field').value='';$('major').value='';run();showResults()});
$('quick').addEventListener('click',e=>{const b=e.target.closest('.chip');if(!b)return;
  $('kw').value=b.getAttribute('aria-pressed')==='true'?'':b.dataset.q;run()});
$('list').addEventListener('click',e=>{const b=e.target.closest('.copy');if(!b)return;
  const done=()=>{b.textContent='Copied';setTimeout(()=>b.textContent='Copy link',1500)};
  try{navigator.clipboard.writeText(b.dataset.url).then(done,()=>{b.textContent=b.dataset.url})}catch(err){b.textContent=b.dataset.url}});
apply();run();

/* ---------- Resume matcher ---------- */
let sample=null,imgOk=false,pdfOk=false,file=null,ctl=null,blocked=false;
const mstatus=(t,err)=>{$('mstatus').textContent=t;$('mstatus').classList.toggle('err',!!err)};
/* Progress bar. The AI calls don't report progress, so each stage creeps toward its ceiling (never reaching it) until the stage really finishes. */
let prog=0,progT=null,progHide=null;
function progPaint(){const p=Math.round(prog);$('mfill').style.width=p+'%';$('mpct').textContent=p+'%';$('mprog').setAttribute('aria-valuenow',p)}
function progSet(p){prog=Math.max(prog,Math.min(100,p));progPaint()}
function progCrawl(ceil){clearInterval(progT);progT=setInterval(()=>progSet(prog+(ceil-prog)*0.03),300)}
function progStart(){clearTimeout(progHide);clearInterval(progT);prog=0;$('mprog').hidden=false;progPaint();progSet(2)}
function progEnd(ok){clearInterval(progT);if(ok){progSet(100);progHide=setTimeout(()=>{$('mprog').hidden=true},1200)}else $('mprog').hidden=true}
(async()=>{
  try{const r=await fetch(MATCH_API);sample=r.ok&&(await r.json()).ok?sampleApi:null}catch(e){sample=null}
  if(!sample){mstatus('Resume matching is not set up on this site yet.');$('mgo').disabled=true;return}
  try{const lim=await sample.limits();imgOk=!!lim.images;pdfOk=!!lim.pdf}catch(e){}
})();
const drop=$('drop');
['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('over')}));
['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('over')}));
drop.addEventListener('drop',e=>{const f=e.dataTransfer.files[0];if(f){file=f;$('fname').textContent=f.name}});
$('file').addEventListener('change',e=>{file=e.target.files[0]||null;$('fname').textContent=file?file.name:''});

function loadScript(src){return new Promise((ok,no)=>{const s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=()=>no(new Error('load'));document.head.appendChild(s)})}
async function pdfText(f){
  if(!window.pdfjsLib){
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js');
  }
  const doc=await pdfjsLib.getDocument({data:await f.arrayBuffer()}).promise;let out='';
  for(let i=1;i<=Math.min(doc.numPages,6);i++){const c=await(await doc.getPage(i)).getTextContent();out+=c.items.map(it=>it.str+(it.hasEOL?'\n':' ')).join('')+'\n'}
  return out;
}
async function docxText(f){
  if(!window.mammoth)await loadScript('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js');
  return (await mammoth.extractRawText({arrayBuffer:await f.arrayBuffer()})).value;
}
async function getResume(){
  const pasted=$('paste').value.trim();
  if(pasted)return{text:pasted};
  if(!file)throw{code:'nofile'};
  const n=file.name.toLowerCase();
  if(file.type.startsWith('image/')){if(!imgOk)throw{code:'noimg'};return{text:'',image:file}}
  if(n.endsWith('.pdf')){
    let text='';try{text=await pdfText(file)}catch(e){if(!pdfOk)throw e}
    // When the AI can read the PDF itself, send the file: it sees the real layout, columns and scanned pages.
    return pdfOk&&file.size<3.5e6?{text,pdf:file}:{text};
  }
  if(n.endsWith('.docx'))return{text:await docxText(file)};
  return{text:await file.text()};
}
const FIELD_KEYS=Object.keys(CAT);
const low=a=>(a||[]).map(s=>String(s).toLowerCase().trim()).filter(s=>s.length>1);
function profileTerms(p){
  const sk=p.skills||{};
  const words=[...low(p.keywords),...low(sk.technical),...low(sk.tools),...low(p.targetRoles).flatMap(r=>[r,...r.split(/\s+/).filter(w=>w.length>3&&!/intern|engineer|analyst|associate|specialist/.test(w))]),...low(p.coursework).slice(0,10)];
  return [...new Set(words)].slice(0,70);
}
function shortlist(p){
  const kws=profileTerms(p);
  const fields=(p.fields||[]).filter(f=>CAT[f]);
  const useTerm=$('mterm').checked;
  const scored=[];
  for(const x of L){
    if(useTerm&&!termOk(x))continue;
    if(!sideOk(x))continue;
    if(p.degree&&x.deg.length&&!x.deg.includes(p.degree))continue;
    if(p.degree==="Bachelor's"&&/\b(phd|ph\.d|doctoral|postdoc)\b/i.test(x.title))continue;
    let s=0;const fi=Math.min(...x.cats.map(c=>{const i=fields.indexOf(c);return i<0?99:i}));if(fi<99)s+=8-Math.min(fi,4)*1.5;
    const text=x.hay+' '+(x.sum?((x.sum.r||'')+' '+(x.sum.l||'')).toLowerCase():'');
    for(const k of kws)if(text.includes(k))s+=x.hay.includes(k)?2.5:1;
    s+=x.rt/10;
    if(s>1)scored.push([s,x]);
  }
  scored.sort((a,b)=>b[0]-a[0]||b[1].t-a[1].t);
  return scored.slice(0,150).map(a=>a[1]);
}
function arr(a){return (a||[]).filter(Boolean)}
function showProfile(p){
  const sk=p.skills||{};
  const sec=(t,items)=>items.length?`<div class="pf-sec"><b>${t}</b><ul>${items.map(i=>`<li>${i}</li>`).join('')}</ul></div>`:'';
  const exp=arr(p.experience).map(e=>`<strong>${esc(e.role||'')}</strong>${e.org?' · '+esc(e.org):''}${e.dates?` <span class="pf-d">${esc(e.dates)}</span>`:''}${arr(e.highlights).length?'<br>'+arr(e.highlights).map(esc).join(' · '):''}`);
  const proj=arr(p.projects).map(e=>`<strong>${esc(e.name||'')}</strong>${arr(e.tech).length?' · '+arr(e.tech).map(esc).join(', '):''}${e.what?'<br>'+esc(e.what):''}`);
  const prof=$('profile');prof.hidden=false;
  prof.innerHTML=`<details class="pf" open><summary><span class="lbl">What the AI read from your resume</span> <span class="pf-note">Check it caught everything. If something's missing, paste your resume text instead.</span></summary>
    <p class="pf-sum">${esc(p.summary||'')}</p>
    <div class="pf-tags">${[p.major,p.minor,p.level,p.gradYear&&('Class of '+p.gradYear),p.gpa&&('GPA '+p.gpa)].filter(Boolean).map(t=>`<span class="tag">${esc(t)}</span>`).join('')}${(p.fields||[]).filter(f=>CAT[f]).map(f=>`<span class="tag term">${esc(CAT[f])}</span>`).join('')}</div>
    <div class="pf-grid">
      ${sec('Experience',exp)}${sec('Projects',proj)}
      ${sec('Skills',[arr(sk.technical).length&&'Technical: '+arr(sk.technical).map(esc).join(', '),arr(sk.tools).length&&'Tools: '+arr(sk.tools).map(esc).join(', '),arr(sk.languages).length&&'Languages: '+arr(sk.languages).map(esc).join(', ')].filter(Boolean))}
      ${sec('Coursework',arr(p.coursework).length?[arr(p.coursework).map(esc).join(', ')]:[])}
      ${sec('Leadership & activities',arr(p.leadership).map(esc))}
      ${sec('Certifications & awards',arr(p.awards).map(esc))}
      ${sec('Interests',arr(p.interests).length?[arr(p.interests).map(esc).join(', ')]:[])}
      ${sec('Best-suited roles',arr(p.targetRoles).length?[arr(p.targetRoles).map(esc).join(' · ')]:[])}
      ${sec('Strengths a recruiter would notice',arr(p.strengths).map(esc))}
    </div></details>`;
}
const ERR={not_granted:'Claude access was declined for this page, so matching is off.',rate_limited:'Too many requests right now. Wait a minute and try again.',network:'Could not reach the server. Check your connection.',
  session_expired:'Sign in to Claude again, then retry.',refused:'The AI could not process this resume. Try pasting the text instead.',
  invalid_json:'The match results came back garbled. Try again.',image_rejected:'That image could not be read. Try a PDF or paste the text.'};
$('mstop').addEventListener('click',()=>ctl&&ctl.abort());
$('mgo').addEventListener('click',async()=>{
  if(!sample)return;
  read();
  $('mgo').disabled=true;$('mstop').hidden=false;ctl=new AbortController();
  let ok=false;
  try{
    progStart();
    mstatus('Opening your resume…');
    const r=await getResume();
    if(!r.image&&!r.pdf&&r.text.trim().length<80)throw{code:'short'};
    progSet(8);
    mstatus('Reading your whole resume…');
    progCrawl(44);
    const src=r.pdf?'the attached PDF':r.image?'the attached image':'the resume text below';
    const p=await sample.json(`You are an experienced university recruiter screening a student's resume for internships.
Read ${src} completely: education, every job and internship, every project, research, leadership, activities, coursework, skills, certifications, awards and interests. Do not skip sections, and use only what the resume actually says.
Reply with only this JSON object:
{"summary": "2-3 sentences a recruiter would write: who they are, their strongest experience and what they're ready for",
 "major": "", "minor": "", "school": "", "level": "freshman|sophomore|junior|senior|master's|PhD (estimate from graduation date if needed)", "gradYear": "", "gpa": "" ,
 "degree": "Bachelor's" | "Master's" | "PhD" | "Associate's" | "",
 "experience": [{"role": "", "org": "", "dates": "", "highlights": ["short, specific accomplishments with tools and results"]}],
 "projects": [{"name": "", "tech": [""], "what": "one sentence on what they built and the result"}],
 "leadership": ["role, organization"], "coursework": ["relevant courses"],
 "skills": {"technical": [""], "tools": [""], "languages": ["spoken languages"]},
 "awards": ["certifications, honors, awards"], "interests": [""],
 "strengths": ["3-5 strengths a recruiter would notice, each tied to evidence on the resume"],
 "targetRoles": ["6-10 specific internship titles this person is best suited for"],
 "fields": up to 4 keys from ${JSON.stringify(FIELD_KEYS)} ordered best fit first,
 "keywords": ["25-40 lowercase words or short phrases likely to appear in titles of internships that fit them, e.g. \\"fpga\\", \\"embedded\\", \\"supply chain\\""]}
${r.pdf||r.image?'':'\nRESUME:\n'+r.text.slice(0,20000)}`,{signal:ctl.signal,modelTier:'quick',images:r.image||undefined,pdf:r.pdf||undefined});
    showProfile(p);
    progSet(46);
    const cands=shortlist(p);
    if(!cands.length)throw{code:'none'};
    progSet(50);
    mstatus(`Comparing ${cands.length} internships against your full resume…`);
    progCrawl(95);
    const lines=cands.map(x=>{const w=x.sum&&x.sum.l?` | wants: ${x.sum.l.slice(0,160)}`:'';return `${x.id} | ${x.co} | ${x.title} | ${CAT[x.cat]} | ${x.terms.join('/')} | ${(x.locs[0]||'')} | ${x.deg.length?x.deg.join('/'):'any degree'}${w}`}).join('\n');
    const prof=JSON.stringify({summary:p.summary,level:p.level,gradYear:p.gradYear,major:p.major,minor:p.minor,degree:p.degree,gpa:p.gpa,experience:p.experience,projects:p.projects,leadership:p.leadership,coursework:p.coursework,skills:p.skills,awards:p.awards,interests:p.interests,targetRoles:p.targetRoles});
    const rank=await sample.json(`You are a university recruiter matching one student to internships. Judge every listing against the student's FULL background below, the way a hiring manager would.

STUDENT (from their resume):
${prof}

Score each listing 0-100 with this rubric:
- 40 pts: skills and tools match what the role needs
- 30 pts: relevant experience, projects or research they can point to in an interview
- 15 pts: eligibility and level (class year, degree, timing; heavily penalize PhD/MS-only roles for undergrads and roles clearly above their level)
- 15 pts: fit with their interests, coursework and the roles they're best suited for
Prefer roles they could realistically get an interview for. Use the "wants" notes when present.

LISTINGS (id | company | title | field | term | location | degree | wants):
${lines}

Pick the 15 best fits. Reply with only a JSON array, best first:
[{"id": number, "score": integer 0-100, "why": "one sentence under 28 words naming the specific experience, project or skill from their resume that fits this role", "gap": "under 12 words: the main thing to strengthen or highlight for this role, or empty"}]`,{signal:ctl.signal});
    const seen=new Set();
    matchList=(Array.isArray(rank)?rank:[]).map(m=>({id:Number(m.id),score:Math.max(0,Math.min(100,Math.round(Number(m.score)||0))),why:String(m.why||''),gap:String(m.gap||'')}))
      .filter(m=>L[m.id]&&cands.includes(L[m.id])&&!seen.has(m.id)&&seen.add(m.id));
    if(!matchList.length)throw{code:'none'};
    ok=true;
    $('tabMatch').hidden=false;setView('match');
    mstatus(`Found ${matchList.length} matches, ranked against your whole resume.`);
    $('tabMatch').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(e){
    const c=e&&e.code;
    if(c==='cancelled')mstatus('Stopped.');
    else if(c==='nofile')mstatus('Choose a resume file or paste the text first.',true);
    else if(c==='short')mstatus('Could not read much text from that file. Try pasting the text instead.',true);
    else if(c==='noimg')mstatus('Photos are not supported here. Upload a PDF or paste the text.',true);
    else if(c==='none')mstatus('No good matches in this season and year. Untick the season filter or change it above.',true);
    else if(ERR[c])mstatus(ERR[c]+(e.detail?' Details: '+e.detail:''),true);
    else if(e&&e.message==='load')mstatus('Could not load the file reader. Paste the resume text instead.',true);
    else mstatus('Something went wrong reading the resume. Try again, or paste the text.',true);
    if(['not_granted','sampling_disabled','not_declared','capability_disabled'].includes(c))blocked=true;
  }finally{
    progEnd(ok);
    $('mgo').disabled=blocked||!sample;
    $('mstop').hidden=true;ctl=null;
  }
});
})();
