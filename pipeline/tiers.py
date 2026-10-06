# brand recognition / prestige tiers (Claude's judgment). score out of 10
T={}
def add(score, names):
    for n in names.split('|'): T[n.strip().lower()]=score
add(10,"nvidia|google|apple|meta|microsoft|amazon|openai|anthropic|jane street|citadel|citadel securities|hudson river trading|two sigma|d. e. shaw|d.e. shaw|optiver|imc|imc trading|jump trading|spacex|netflix|stripe|goldman sachs|mckinsey|bcg|bain|five rings capital|renaissance technologies|deepmind|tesla|nasa|nasa jpl|the white house")
add(9.3,"amd|intel|qualcomm|disney|the walt disney company|jpmorgan chase|jp morgan chase|jpmorganchase|morgan stanley|blackstone|blackrock|palantir|palantir technologies|databricks|figma|anduril|neuralink|waymo|tiktok|bytedance|adobe|salesforce|uber|airbnb|coinbase|roblox|linkedin|spotify|nike|procter & gamble|coca-cola|pepsico|boeing|lockheed martin|susquehanna international group (sig)|susquehanna|susquehanna international group|drw|tower research capital|point72|kkr|evercore|lazard|centerview partners|pimco|bridgewater|de shaw|g-research|akuna capital|epic games|riot games|cia|fbi|nsa|u.s. department of state|federal reserve|apple inc.|oracle|ibm|cisco|nasa ames|blue origin|rivian|lucid|ramp|notion|duolingo|doordash|doordash usa|lyft|pinterest|snap|dropbox|atlassian|intuit|vercel|scale ai|etched|together ai|lightmatter")
add(8.5,"marvell|micron technology|analog devices|texas instruments|nxp semiconductors|applied materials|kla|lam research|broadcom|arm|cadence design systems|synopsys|western digital|dell technologies|hp|hp iq|hewlett packard enterprise|honeywell|northrop grumman|rtx|raytheon|general dynamics|ge aerospace|ge healthcare|ge vernova|siemens|3m|johnson & johnson|pfizer|merck|eli lilly|abbvie|amgen|genentech|moderna|medtronic|boston scientific|stryker|bank of america|citi|wells fargo|capital one|american express|mastercard|visa|fidelity investments|vanguard|bnY|bny|barclays|deutsche bank|ubs|jefferies|houlihan lokey|moelis & company|perella weinberg partners|rothschild & co|william blair|baird|deloitte|pwc|ernst & young|ey|kpmg|accenture|booz allen|booz allen hamilton|universal orlando resort|royal caribbean group|carnival corporation|mgm resorts international|delta air lines|united airlines|american airlines|nbcuniversal|warner bros. discovery|paramount|sony pictures|fox corporation|espn|nba|nfl|mlb|electronic arts|activision blizzard|verkada|samsara|skydio|astranis|zipline|rocket lab usa|k2 space|impulse space|hermeus|sierra nevada corporation|johns hopkins applied physics laboratory|lawrence livermore national laboratory (llnl)|sandia national laboratories|oak ridge national laboratory|argonne national laboratory|mit lincoln laboratory|the aerospace corporation|draper|general motors|ford|toyota|stellantis|caterpillar|john deere|unilever|nestlé|l'oréal|estée lauder companies|lvmh|walmart|target|the home depot|ibm research|dow jones|the new york times|the washington post|wellington management|capital group|t. rowe price|state street|apollo global management|carlyle|ares management|virtu financial|belvedere trading|chicago trading company|peak6|old mission|geneva trading|dv trading|schonfeld|brevan howard|aqr capital management|millennium|balyasny|walleye capital|maven securities|pdt partners|quantbot technologies|hyannis port research|cubist|gm financial")
add(7.2,"keysight technologies|ciena|corning|semtech|qorvo|skyworks|onsemi|solidigm|entegris|tokyo electron|ambarella|jabil|teledyne|leidos|saic|caci|peraton|bae systems|l3harris|textron|oshkosh|moog|aerovironment|saab|eaton|emerson electric|rockwell automation|abb|schneider electric|vertiv|philips|motorola|motorola solutions|nokia|ericsson|verizon communications|at&t|t-mobile|comcast|cox|directv|nextera energy / fpl|nextera energy|duke energy|xcel energy|constellation energy|entergy|ameren|edison international|kinder morgan|energy transfer partners|exxonmobil|chevron|shell|bp|dow|basf|cargill|general mills|kraft heinz|mars|hershey|conagra brands|kroger|lowe's|costco|best buy|nordstrom|macy's|tjx companies|gap inc.|ulta beauty|ralph lauren|pvh corp.|tapestry|lululemon|new balance|adidas|under armour|state farm|usaa|progressive|allstate|liberty mutual|travelers|nationwide|northwestern mutual|guardian life|principal financial group|prudential|metlife|navy federal|td bank|royal bank of canada|u.s. bank|pnc|fifth third bank|citizens financial group|truist|freddie mac|fannie mae|dtcc|occ|cboe|nasdaq|ice|tradeweb|lpl financial holdings|invesco|franklin templeton|dimensional fund advisors|mfs|american century investments|stifel|raymond james|grant thornton|rsm|bdo|crowe|baker tilly|cbiz|forvis mazars|plante moran|cherry bekaert|eisneramper|cbre|jll|cushman & wakefield|colliers|hines|prologis|simon property group|zillow|costar group|ups|united parcel service|fedex|c.h. robinson|j.b. hunt|dhl express|maersk|csx|union pacific|bnsf|autodesk|autozone|ibotta|klaviyo|rippling|appian|veeam software|q2|kinaxis|geotab|singlestore|immuta|id.me|perpay|ramp|draftkings|epic|cerner|optum|unitedhealth group|cigna group|cvs health|hca healthcare|mayo clinic|cleveland clinic|labcorp|medpace|medline|zimmer biomet holdings|atricure|abcellera|pathai|regeneron|vertex pharmaceuticals|biogen|bristol myers squibb|gilead sciences|novartis|sanofi|astrazeneca|gsk|nbc|sirius xm|siriusxm|live nation|universal music group|sony music|warner music group|condé nast|vox media|lionsgate|a24|wme / endeavor|caa|edelman|ogilvy|wieden+kennedy|vaynermedia|pga tour|nascar|mls|nhl|ncaa|octagon|brookings institution|rand corporation|urban institute|council on foreign relations|smithsonian institution|environmental defense fund|world resources institute|nrdc|sierra club|earthjustice|unicef|american red cross|habitat for humanity|teach for america|cdc|nih|epa|u.s. department of energy|u.s. department of justice|u.s. house of representatives|americorps|aclu|wyndham hotels & resorts|hershey entertainment & resorts|kairos power|general matter|pacific fusion|mach industries|bedrock robotics|gecko robotics|cesiumastro|muon space|lunar outpost|amca|zurn elkay water solutions|the toro company|vermeer|stanley black & decker|westinghouse electric company|ge appliances|lennox international|clarios|brunswick|uline|enterprise holdings|avis budget group|w.w. grainger|h&r block|assurant|thrivent|pacific life|western & southern financial group|auto-owners insurance|manulife financial|wellmark|excellus bcbs|louisiana blue|copart|meijer|hy-vee|dick's sporting goods|fairlife|post holdings|gordon food service|hydrite|marmon holdings|itron|greenheck group|nidec|itt|ecg management consultants|wsp|aecom|jacobs|stantec|hdr|arcadis|bechtel|kiewit|turner|tetra tech|ramboll|deloitte consulting|guidehouse|gallup|icf international|acxiom|lincoln international|audax group|audax private equity|castleton commodities international|garda capital partners|seven research|ttwg global|twg global|talos|ont finance|one finance")
def _unused(): pass
def score(co):
    k=co.strip().lower()
    if k in T: return T[k]
    # loose contains match on distinctive names
    for n,s in T.items():
        if len(n)>=5 and (k.startswith(n+' ') or k.startswith(n+',') or n==k.split(' (')[0]): return s
    return None
add(7.5,"huawei technologies canada co., ltd.")
add(6.5,"shure|eqt corporation|momentive")
add(6,"equipmentshare|benesch|northmarq|definity financial|the nuclear company")
add(5,"interstates|first national bank|f.h. paschen|consigli construction|clyde companies|tippmann group|wight & company|felsburg holt & ullevig|springs window fashions")
import re
def hourly(p):
    if not p: return None
    s=p.replace(',','')
    nums=[float(n) for n in re.findall(r'(\d+(?:\.\d+)?)',s)]
    nums=[n for n in nums if n>=8]
    if not nums: return None
    v=sum(nums[:2])/len(nums[:2])
    low=s.lower()
    if 'month' in low: v=v/173
    elif v>1000 or '/yr' in low or 'annual' in low or 'salary' in low: v=v/2080
    if 'cad' in low: v*=0.73
    if v<8 or v>300: return None
    return v
def payscore(h):
    pts=[(15,1),(20,3),(25,4.5),(30,5.5),(40,7),(50,8),(65,9),(90,10)]
    if h<=15: return 1.0
    for (a,sa),(b,sb) in zip(pts,pts[1:]):
        if h<=b: return sa+(sb-sa)*(h-a)/(b-a)
    return 10.0
def rate(co,pay):
    b=score(co); known=b is not None
    if not known: b=2.5
    h=hourly(pay)
    if h is not None: ps=payscore(h)
    else: ps=max(1.5,b-0.8) if known else 2.5
    r=0.65*b+0.35*ps
    r=max(1.0,min(9.9,r))
    return round(r,1),b,(round(h) if h else None)
add(8.5,"marriott international|hilton|hyatt|four seasons")
add(9.3,"the metropolitan museum of art|moma (museum of modern art)|national science foundation|princeton neuroscience institute")
add(9,"noaa|getty|johns hopkins medicine")
add(8.5,"woods hole oceanographic institution|gensler|atlantic records|mayo clinic")
add(7.5,"marine biological laboratory|american psychological association|noaa office for coastal management")
add(6.5,"mote marine laboratory|breakthrough collaborative|phillip and patricia frost museum of science")
add(5.5,"baptist health (arkansas)")
