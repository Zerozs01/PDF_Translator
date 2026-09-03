const KOREAN_HANGUL_REGEX = /[\uAC00-\uD7AF]/;
const KOREAN_THAI_REGEX = /[\u0E00-\u0E7F]/g;
const KOREAN_LATIN_REGEX = /[A-Za-z]/g;

const normalizeWhitespace = (text: string): string => String(text || '').replace(/\s+/g, ' ').trim();

const buildComparisonKey = (text: string): string => normalizeWhitespace(text)
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, '');

const KOREAN_COLLOQUIAL_REPAIRS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /말어(?![\uAC00-\uD7AF])/g, replacement: '말아' },
  { pattern: /줘\s+말아(?![\uAC00-\uD7AF])/g, replacement: '줘 말아' },
  { pattern: /([\uAC00-\uD7AF]+?)을라고/g, replacement: '$1으려고' },
  { pattern: /([\uAC00-\uD7AF]+?)를라고/g, replacement: '$1려고' },
  { pattern: /하느데(?![\uAC00-\uD7AF])/g, replacement: '하는데' },
  { pattern: /아뎨요(?![\uAC00-\uD7AF])/g, replacement: '아녜요' },
];

const preserveSourceTrailingPunctuation = (sourceText: string, replacement: string): string => {
  const punctuation = String(sourceText || '').trim().match(/([.!?…\u002D\u2010-\u2015\u2212\u00AD~♡♥]+)$/)?.[1] || '';
  const cleanReplacement = normalizeWhitespace(String(replacement || '')).replace(/[.!?…\u002D\u2010-\u2015\u2212\u00AD~♡♥]+$/g, '').trim();
  return `${cleanReplacement}${punctuation}`.trim();
};

const KOREAN_CONVERSATIONAL_FALLBACKS: Array<{ pattern: RegExp; replacement: string }> = [
  // Short SFX / single-word fallbacks
  { pattern: /^하앙$/, replacement: 'ฮ๊าง' },
  { pattern: /^하앙\?+$/, replacement: 'ฮ๊าง!?' },
  { pattern: /^하앙!+$/, replacement: 'ฮ๊าง!!' },
  { pattern: /^헉$/, replacement: 'เฮือก' },
  { pattern: /^헉헉$/, replacement: 'แฮ่กๆ' },
  { pattern: /^하하$/, replacement: 'ฮ่าๆ' },
  { pattern: /^하하하$/, replacement: 'ฮ่าๆๆ' },
  { pattern: /^후후$/, replacement: 'หึๆ' },
  { pattern: /^음$/, replacement: 'อืม' },
  { pattern: /^응$/, replacement: 'อืม' },
  { pattern: /^아$/, replacement: 'อา' },
  { pattern: /^앗$/, replacement: 'อ๊ะ' },
  { pattern: /^어$/, replacement: 'เอ๊ะ' },
  { pattern: /^어라$/, replacement: 'เอ๊ะ' },
  { pattern: /^오$/, replacement: 'โอ้' },
  { pattern: /^에$/, replacement: 'เอ๋' },
  { pattern: /^우와$/, replacement: 'ว้าว' },
  { pattern: /^쉿$/, replacement: 'ชู่ว' },
  { pattern: /^짝$/, replacement: 'แปะ' },
  { pattern: /^쾅$/, replacement: 'ปัง' },
  { pattern: /^탁$/, replacement: 'ตึก' },
  { pattern: /^끄덕$/, replacement: 'พยักหน้า' },
  { pattern: /^절레$/, replacement: 'ส่ายหน้า' },
  { pattern: /^안녕$/, replacement: 'สวัสดี' },
  { pattern: /^네$/, replacement: 'ใช่' },
  { pattern: /^아니$/, replacement: 'ไม่' },
  { pattern: /^진짜$/, replacement: 'จริงเหรอ' },
  { pattern: /^제발$/, replacement: 'ได้โปรด' },

  // Phrases & colloquial patterns
  { pattern: /^자신이무시하던남자에게엉덩이활짝내밀고든$/, replacement: 'เธอยื่นก้นออกไปให้ผู้ชายที่เธอเคยเมินเฉย' },
  { pattern: /^쾌락에패배하고굴복해서$/, replacement: 'พ่ายแพ้และยอมจำนนต่อความสุข' },
  { pattern: /^가장무방비한자세로보지대주고있는상황을$/, replacement: 'สถานการณ์ที่เสนออวัยวะเพศหญิงของตนเองในตำแหน่งที่ไร้การป้องกันที่สุด' },
  { pattern: /^걸레년$/, replacement: 'อีผู้หญิงสำส่อน' },
  { pattern: /^이거이거$/, replacement: 'เรื่องนี้ เรื่องนี้' },
  { pattern: /^넘어가줘말[어아]$/, replacement: 'ฉันควรปล่อยผ่านไปหรือไม่?' },
  { pattern: /^지울거지응$/, replacement: 'แกจะลบมันใช่ไหม? ฮึ?' },
  { pattern: /^잘나왔던데왜지워$/, replacement: 'มันออกมาดีนี่ ทำไมต้องลบ?' },
  { pattern: /^출력해서집에붙여놓을라고하는데ㅋ+$/, replacement: 'ฉันวางแผนจะพิมพ์ออกมาแล้วเอาไปติดไว้ที่บ้าน ฮ่าๆ' },
  { pattern: /^붙여놓을라고하는데$/, replacement: 'ฉันวางแผนจะเอาไปแขวนไว้' },
  { pattern: /^분여놓을라고하느데$/, replacement: 'ฉันวางแผนจะเอาไปแขวนไว้' },
  { pattern: /^또라이같은년이지가보내놓고왜지랄이지$/, replacement: 'ยัยบ้าคนนั้นกำลังโวยวายทั้งที่ตัวเองเป็นคนส่งมาเหรอ?' },
  { pattern: /^또라이같은년이지가보내놓고왜지랄이야$/, replacement: 'ยัยบ้าคนนั้นกำลังโวยวายทั้งที่ตัวเองเป็นคนส่งมาเหรอ?' },
  { pattern: /^미친[색섹새]까뒤지기싫으면$/, replacement: 'ไอ้สารเลว ถ้าไม่อยากตาย' },
  { pattern: /^빨리지워라$/, replacement: 'ลบมันซะเร็วๆ' },
  { pattern: /^안지우면진짜$/, replacement: 'ถ้าไม่ลบ' },
  { pattern: /^죽여버릴거야$/, replacement: 'ฉันจะฆ่าแกจริงๆ' },
  { pattern: /^음뭐지이$/, replacement: 'หืม! นี่อะไรกันเนี่ย?' },
  { pattern: /^가장빠른입분제공사이트$/, replacement: 'เว็บไซต์ให้บริการเข้าเร็วที่สุด' },
  { pattern: /^데자뷰같은이느낌$/, replacement: 'ความรู้สึกนี้เหมือนเคยเกิดขึ้นมาก่อน' },
  { pattern: /^출력$/, replacement: 'พิมพ์ออกมา' },
  { pattern: /^미친$/, replacement: 'บ้าเอ๊ย' },
  { pattern: /^몸으로때운다고$/, replacement: 'จะใช้ร่างกายชดเชยงั้นเหรอ?' },
  { pattern: /^그사진지워주면$/, replacement: 'ถ้าคุณลบรูปนั้น' },
  { pattern: /^내가뭐든할게$/, replacement: 'ฉันจะทำอะไรก็ได้' },
  { pattern: /^뭐든한다고$/, replacement: 'ทำอะไรก็ได้งั้นเหรอ?' },
  { pattern: /^응몸으로때울수있는거라면뭐든$/, replacement: 'อืม ถ้าเป็นอะไรที่เอาร่างกายชดเชยได้ก็ตามนั้น...' },
  { pattern: /^그렇지역시$/, replacement: 'ใช่แล้ว! อย่างที่ฉันคาดไว้เลย' },
  { pattern: /^자아물어라물어$/, replacement: 'เอาล่ะ ถามมาได้เลย' },
  { pattern: /^미안해맹호야$/, replacement: 'ฉันขอโทษนะ แมงโฮ' },
  { pattern: /^미미안해뱅호야$/, replacement: 'ฉันขอโทษจริงๆ บังโฮ' },
  { pattern: /^내가잘못했어$/, replacement: 'ฉันผิดเอง' },
  { pattern: /^화내지말고$/, replacement: 'อย่าโกรธสิ' },
  { pattern: /^내가어떡하면될까$/, replacement: 'ฉันควรทำยังไงดี?' },
  { pattern: /^뭐야갑자기이년이꼬랑지를내리네$/, replacement: 'อะไรนะ? จู่ๆ ยัยนี่ก็ยอมแล้วเหรอ?' },

  // Conversational additions to clean up common Argos hallucinations
  { pattern: /^그런데$/, replacement: 'อย่างไรก็ตาม' },
  { pattern: /^저기요$/, replacement: 'ขอโทษนะ' },
  { pattern: /^당연한거아니야$/, replacement: 'แน่นอนอยู่แล้วไม่ใช่เหรอ' },
  { pattern: /^똑바로누워$/, replacement: 'นอนตรงๆ' },
  { pattern: /^이런$/, replacement: 'แบบนี้' },
  { pattern: /^자$/, replacement: 'เอาล่ะ' },
  { pattern: /^이나이에섹스를하는것만으로도\D*죄책감이\d*장난아닌데\D*$/, replacement: 'ในวัยนี้ แค่มีเพศสัมพันธ์… ความรู้สึกผิดไม่ใช่เรื่องเล่นๆเลย…' },
  { pattern: /^빨리지워응너그런거필요$/, replacement: 'ลบออกเร็วๆ สิ เธอจำเป็นต้องมีของแบบนั้นด้วยเหรอ?' },
  { pattern: /^엇얘기끝났어$/, replacement: 'เอ๊ะ! คุยกันเสร็จแล้วเหรอ?' },
  { pattern: /^수진짜알지$/, replacement: 'ซู!! รู้จริงๆ ใช่ไหม?' },
  { pattern: /^짓이넘어가준다$/, replacement: 'ยอมมองข้ามการกระทำนี้ให้ก็ได้' },
  
  // Conversational fallbacks for Korean Manhwa common words / Argos boilerplate prevention
  { pattern: /^어쩔수$/, replacement: 'ช่วยไม่ได้นะ' },
  { pattern: /^어쩔수없지$/, replacement: 'ช่วยไม่ได้ล่ะนะ' },
  { pattern: /^밑으로$/, replacement: 'ข้างล่าง' },
  { pattern: /^잠깐$/, replacement: 'เดี๋ยวก่อน' },
  { pattern: /^잠깐만$/, replacement: 'แป๊บนึงนะ' },
  { pattern: /^뭐야$/, replacement: 'อะไรกัน' },
  { pattern: /^아직일러$/, replacement: 'ยังเร็วไป' },
  { pattern: /^그렇게껴안지$/, replacement: 'กอดแน่นขนาดนั้น' },
  { pattern: /^그렇게무서웠어$/, replacement: 'กลัวขนาดนั้นเลยเหรอ' },
  { pattern: /^앉아도$/, replacement: 'ขอนั่งนะ' },
  { pattern: /^이거놔$/, replacement: 'ปล่อยนะ' },
  { pattern: /^이거봐$/, replacement: 'ดูนี่สิ' },
  { pattern: /^너한테$/, replacement: 'กับเธอ' },
  { pattern: /^읏$/, replacement: 'อ๊ะ' },
  { pattern: /^에멕$/, replacement: 'เอ๊ะ' },
  { pattern: /^잠들면$/, replacement: 'ถ้าหลับไป' },

  // Greetings / Social phrases
  { pattern: /^잘부탁해$/, replacement: 'ยินดีที่ได้รู้จัก' },
  { pattern: /^잘부탁드려요$/, replacement: 'ยินดีที่ได้รู้จักครับ' },
  { pattern: /^잘부탁합니다$/, replacement: 'ยินดีที่ได้รู้จักครับ' },
  { pattern: /^반가워$/, replacement: 'ยินดีที่ได้รู้จัก' },
  { pattern: /^반가워요$/, replacement: 'ยินดีที่ได้รู้จักครับ' },
  { pattern: /^처음뵙겠습니다$/, replacement: 'ยินดีที่ได้พบครับ' },

  // Common negative/question phrases
  { pattern: /^안갔지$/, replacement: 'ไม่ได้ไปหรอก' },
  { pattern: /^잘생겼다$/, replacement: 'หล่อจัง' },
  { pattern: /^살생겼의$/, replacement: 'หล่อจัง' },
  { pattern: /^잘생겼의$/, replacement: 'หล่อจัง' },
  { pattern: /^살생겼다$/, replacement: 'หล่อจัง' },
  { pattern: /^안갔어$/, replacement: 'ไม่ได้ไปนะ' },
  { pattern: /^가야해서$/, replacement: 'เพราะต้องไปแล้ว' },
  { pattern: /^가야해$/, replacement: 'ต้องไปแล้ว' },
  { pattern: /^가야돼$/, replacement: 'ต้องไปแล้ว' },
  { pattern: /^왜같이$/, replacement: 'ทำไมถึงมาด้วยกัน' },
  { pattern: /^왜같이왔어$/, replacement: 'ทำไมถึงมาด้วยกัน' },
  { pattern: /^왜왔어$/, replacement: 'ทำไมถึงมา' },
  { pattern: /^얘는$/, replacement: 'เธอเป็นใคร' },
  { pattern: /^얘는\?$/, replacement: 'เธอเป็นใคร?' },
  { pattern: /^뭐야얘는$/, replacement: 'นี่มันเป็นใคร' },

  // Family relationships
  { pattern: /^엄마사촌$/, replacement: 'ลูกพี่ลูกน้องของแม่' },
  { pattern: /^아빠사촌$/, replacement: 'ลูกพี่ลูกน้องของพ่อ' },
  { pattern: /^사촌오빠$/, replacement: 'พี่ชายลูกพี่ลูกน้อง' },
  { pattern: /^사촌언니$/, replacement: 'พี่สาวลูกพี่ลูกน้อง' },
  { pattern: /^사촌동생$/, replacement: 'น้องลูกพี่ลูกน้อง' },

  // Reading inner thoughts (manhwa trope)
  { pattern: /^속마음$/, replacement: 'ความคิดในใจ' },
  { pattern: /^속마음읽지만$/, replacement: 'อ่านความคิดในใจได้แต่...' },
  { pattern: /^읽지만$/, replacement: 'แต่อ่านได้' },

  // Common action phrases
  { pattern: /^뛰어$/, replacement: 'วิ่งไป' },
  { pattern: /^도망쳐$/, replacement: 'หนีไป' },
  { pattern: /^따라와$/, replacement: 'ตามมาด้วย' },
  { pattern: /^빨리$/, replacement: 'เร็วๆ' },
  { pattern: /^조심해$/, replacement: 'ระวังด้วย' },
  { pattern: /^괜찮아$/, replacement: 'ไม่เป็นไร' },
  { pattern: /^알겠어$/, replacement: 'เข้าใจแล้ว' },
  { pattern: /^몰라$/, replacement: 'ไม่รู้' },
  { pattern: /^싫어$/, replacement: 'ไม่อยาก' },
  { pattern: /^좋아$/, replacement: 'โอเค' },
  { pattern: /^고마워$/, replacement: 'ขอบคุณ' },
  { pattern: /^미안$/, replacement: 'ขอโทษ' },

  // Emotions and reactions
  { pattern: /^기분좋아$/, replacement: 'รู้สึกดีจัง' },
  { pattern: /^기분좋다$/, replacement: 'รู้สึกดีจัง' },
  { pattern: /^설레$/, replacement: 'ใจเต้นเลย' },
  { pattern: /^설레다$/, replacement: 'ใจเต้นเลย' },
  { pattern: /^두근두근$/, replacement: 'ใจเต้น ใจเต้น' },
  { pattern: /^창피해$/, replacement: 'อายจัง' },
  { pattern: /^부끄러워$/, replacement: 'อายจัง' },
  { pattern: /^무서워$/, replacement: 'กลัวจัง' },
  { pattern: /^아프다$/, replacement: 'เจ็บจัง' },
  { pattern: /^아파$/, replacement: 'เจ็บ' },
  { pattern: /^행복해$/, replacement: 'มีความสุขจัง' },
  { pattern: /^슬퍼$/, replacement: 'เศร้าจัง' },
  { pattern: /^화나$/, replacement: 'โกรธแล้ว' },
  { pattern: /^화났어$/, replacement: 'โกรธแล้วนะ' },
  { pattern: /^짜증나$/, replacement: 'น่ารำคาญ' },

  // Common questions / exclamations
  { pattern: /^왜\?$/, replacement: 'ทำไม?' },
  { pattern: /^왜$/, replacement: 'ทำไม' },
  { pattern: /^어떻게$/, replacement: 'ยังไงอะ' },
  { pattern: /^정말\?$/, replacement: 'จริงเหรอ?' },
  { pattern: /^정말$/, replacement: 'จริงเหรอ' },
  { pattern: /^진짜\?$/, replacement: 'จริงเหรอ?' },
  { pattern: /^설마$/, replacement: 'ไม่ใช่แน่ๆ' },
  { pattern: /^혹시$/, replacement: 'หรือเปล่า' },
  { pattern: /^역시$/, replacement: 'อย่างที่คิดเลย' },
  { pattern: /^어떡해$/, replacement: 'ทำไงดี' },
  { pattern: /^어떡하지$/, replacement: 'ทำไงดีนะ' },
  { pattern: /^그래도$/, replacement: 'ถึงอย่างนั้น' },
  { pattern: /^그래서$/, replacement: 'แล้วก็เลย' },
  { pattern: /^그러니까$/, replacement: 'นั่นแหละ' },
  { pattern: /^됐어$/, replacement: 'พอแล้ว' },
  { pattern: /^됐다$/, replacement: 'เสร็จแล้ว' },
  { pattern: /^싫어요$/, replacement: 'ไม่อยากครับ' },

  // Manhwa tropes
  { pattern: /^혼자할때보다기분좋아$/, replacement: 'รู้สึกดีกว่าทำคนเดียวเลย' },
  { pattern: /^기분이좋아$/, replacement: 'รู้สึกดีจัง' },
  { pattern: /^왠지모르게$/, replacement: 'ด้วยเหตุผลบางอย่าง' },
  { pattern: /^왠지$/, replacement: 'ไม่รู้ทำไม' },
  { pattern: /^매일$/, replacement: 'ทุกวัน' },
  { pattern: /^매일매일$/, replacement: 'ทุกวันเลย' },
  { pattern: /^오늘도$/, replacement: 'วันนี้ก็เหมือนกัน' },
  { pattern: /^다른컨셉$/, replacement: 'คอนเซปต์ใหม่' },
  { pattern: /^컨셉$/, replacement: 'คอนเซปต์' },
  { pattern: /^귀엽다$/, replacement: 'น่ารักจัง' },
  { pattern: /^귀여워$/, replacement: 'น่ารัก' },
  { pattern: /^멋있다$/, replacement: 'เท่จัง' },
  { pattern: /^멋있어$/, replacement: 'เท่มาก' },
  { pattern: /^잘생겼다$/, replacement: 'หล่อจัง' },
  { pattern: /^살생겼의$/, replacement: 'หล่อจัง' },
  { pattern: /^잘생겼의$/, replacement: 'หล่อจัง' },
  { pattern: /^살생겼다$/, replacement: 'หล่อจัง' },
  { pattern: /^엄마\s*사촌$/, replacement: 'ลูกพี่ลูกน้องของแม่' },
  { pattern: /^마리코\s*아들$/, replacement: 'ลูกชายของมาริโกะ' },
  { pattern: /^마리코아들$/, replacement: 'ลูกชายของมาริโกะ' },
  { pattern: /^렌이야!?$/, replacement: 'เรนไงล่ะ!' },
  { pattern: /^렌이야$/, replacement: 'เรนไงล่ะ' },
  { pattern: /^당연히안되지$/, replacement: 'แน่นอนว่าไม่ได้หรอก' },
  { pattern: /^당연히$/, replacement: 'แน่นอนอยู่แล้ว' },
  { pattern: /^안되지$/, replacement: 'ไม่ได้หรอก' },
  { pattern: /^꼬맹이네$/, replacement: 'เด็กคนนั้น' },
  { pattern: /^뭐$/, replacement: 'อะไรนะ' },
  { pattern: /^부모님도$/, replacement: 'พ่อแม่ก็ด้วย' },
  { pattern: /^떨굴거야$/, replacement: 'จะทำให้ตก' },
  { pattern: /^그래그래$/, replacement: 'ใช่แล้ว ใช่แล้ว' },
  { pattern: /^렌\?*그렇게\s*껴안지\s*않아도.*$/, replacement: 'เรน? ไม่ต้องกอดแน่นขนาดนั้นก็ได้' },
  { pattern: /^렌\?*껴안지않아도너한$/, replacement: 'เรน? ไม่ต้องกอดก็ได้ ให้เธอ' },
  { pattern: /^렌\?*껴안지않아도$/, replacement: 'เรน? ไม่ต้องกอดก็ได้' },
  { pattern: /^껴안지않아도$/, replacement: 'ไม่ต้องกอดก็ได้' },
  { pattern: /^나보다\s*작은데\s*힘은\s*세.*$/, replacement: 'ตัวเล็กกว่าฉันแท้ๆ แต่แรงเยอะชะมัด' },
  { pattern: /^우와\s*쩔어\s*젖었어.*$/, replacement: 'หวา โคตรสุดยอดเลย แฉะไปหมดแล้ว' },
  { pattern: /^거+거긴\s*만지면.*안돼.*$/, replacement: 'ต... ตรงนั้นถ้าจับล่ะก็ ไม่ได้นะ--' },
  { pattern: /^코토미\s*엄마도\s*내걸로\s*만들어야.*$/, replacement: 'ต้องทำให้แม่ของโคโตมิเป็นของฉันด้วย' },
  { pattern: /^이녀석\s*협박하는\s*건가.*$/, replacement: 'หมอนี่ กำลังข่มขู่อยู่เหรอ?!' },
  { pattern: /^이녀석\s*맘대로하게\s*못냅둬.*$/, replacement: 'จะปล่อยให้หมอนี่ทำตามใจชอบไม่ได้!' },
  { pattern: /^갑자기\s*세게하지마\s*바보야.*$/, replacement: 'อย่าทำแรงกะทันหันสิ เจ้าบ้า!' },
  { pattern: /^빨리싸라\s*꼬맹아.*$/, replacement: 'รีบๆ แตกออกมาสิ เจ้าเด็กบ้า' },
  { pattern: /^그래그래\s*정말이.*$/, replacement: 'ใช่ๆ จริงๆ เลยนะ' },
  { pattern: /^꼬맹이가[우오]?.*$/, replacement: 'เจ้าเด็กคนนี้' },
  { pattern: /^나\s*내일\s*가는데\s*괜찮아.*$/, replacement: 'พรุ่งนี้ฉันจะไปแล้ว ไม่เป็นไรเหรอ?' },
  { pattern: /^올라타\s*코토미.*$/, replacement: 'ขึ้นมาสิ โคโตมิ' },
  { pattern: /^가벼운데.*$/, replacement: 'ตัวเบาจัง' },
  { pattern: /^섹스해줄\s*여자는\s*널려있잖아.*$/, replacement: 'ผู้หญิงที่จะยอมมีเซ็กส์ด้วย มีอยู่เกลื่อนกลาดไม่ใช่เหรอ' },
  { pattern: /^코토미도\s*솔직해져.*$/, replacement: 'โคโตมิเองก็พูดความจริงมาเถอะ' },
  { pattern: /^당연히\s*반하지.*$/, replacement: 'ก็ต้องตกหลุมรักอยู่แล้วสิ...' },
  { pattern: /^의?이건\s*진심으로\s*하고있잖아\s*거절할수가.*$/, replacement: 'นี่มันทำจริงจังเลยนี่นา ปฏิเสธไม่ได้เลย' },
  { pattern: /^키스하면서\s*박는거\s*쩔어.*좋아.*$/, replacement: 'จูบไปพลางเสียบไปพลางนี่โคตรสุดยอดเลย... ชอบจัง' },
  { pattern: /^좋아하게\s*돼버려.*$/, replacement: 'ฉันคงหลงรักเข้าให้แล้ว...' },
  { pattern: /^미안해~*\s*여행까지\s*와서.*$/, replacement: 'ขอโทษนะ~ อุตส่าห์มาเที่ยวด้วยกันแท้ๆ' },
  { pattern: /^진심으로\s*해버렸다.*$/, replacement: 'เผลอทำจริงจังไปซะแล้ว' },
  { pattern: /^민감한데.*$/, replacement: 'ไวต่อความรู้สึกจังนะ' },
  { pattern: /^코토미\s*잔이비었네\s*주스나\s*우롱차줄까.*$/, replacement: 'แก้วของโคโตมิว่างแล้วนี่ เอาน้ำผลไม้หรือชาอู่หลงดีไหม?' },
  { pattern: /^미안해~*\s*다뻗어버려서\s*너희둘은\s*우리방에서\s*자고올래.*$/, replacement: 'ขอโทษนะ~ ทุกคนสลบกันหมดแล้ว พวกเธอสองคนจะไปนอนที่ห้องพวกเราไหม?' },
  { pattern: /^나\s*변탠가의\s*렌한테\s*내애액을.*$/, replacement: 'ฉันลามกงั้นเหรอ? น้ำหล่อลื่นของฉันให้เรน...' },
  { pattern: /^너\s*진짜.*$/, replacement: 'นายเนี่ยจริงๆ เลยนะ' },
  { pattern: /^키스하고\s*싶어.*$/, replacement: 'อยากจูบเหรอ?' },
  { pattern: /^코토미가\s*더\s*귀여워.*$/, replacement: 'โคโตมิ น่ารักกว่าตั้งเยอะ' },
  { pattern: /^이젠\s*좀\s*지쳐서.*$/, replacement: 'ตอนนี้เริ่มเหนื่อยแล้วสิ--' },
  { pattern: /^천~*천히\s*해줄까.*$/, replacement: 'จะทำให้อย่างช้าๆ นะ' },
  { pattern: /^역시\s*이거\s*안돼.*간다.*$/, replacement: 'แบบนี้ไม่ได้จริงๆ ด้วยเหรอ? จะไปแล้วนะ' },
  { pattern: /^움찔움\s*가버리고.*$/, replacement: 'กระตุกเกร็งจนเสร็จไปแล้ว' },
  { pattern: /^존나\s*야한\s*표정으로\s*자지음미하지\s*말라고.*$/, replacement: 'อย่าทำหน้าตาลามกโคตรๆ ตอนกำลังลิ้มรสควยสิ~' },
  { pattern: /^옆방에\s*들리게\s*울어.*$/, replacement: 'ครางให้ห้องข้างๆ ได้ยินไปเลย' },
  { pattern: /^어머나\s*매점에서\s*약사올까.*$/, replacement: 'ตายจริง จะให้ไปซื้อยาที่ร้านค้าให้ไหม?' },
  { pattern: /^코토미\s*렌이쓸이불\s*두고갈게.*$/, replacement: 'โคโตมิ ฉันวางผ้าห่มสำหรับเรนไว้ให้นะ~' },
  { pattern: /^쌀\s*것\s*같아.*뽀뽀\s*해줘.*$/, replacement: 'ฉันจะแตกแล้ว... จูบฉันทีสิ...' },
  { pattern: /^파이즈리\s*처음\s*이라고.*좀\s*더\s*살살해.*$/, replacement: 'เพิ่งเคยทำไพซุริครั้งแรก... เบาๆ หน่อยสิ' },
  { pattern: /^무서운데\s*남의\s*집이라\s*말하기\s*좀.*$/, replacement: 'กลัวนะ แต่เพราะเป็นบ้านคนอื่นเลยพูดยากนิดหน่อย' },
  { pattern: /^내것이.*$/, replacement: 'เป็นของฉัน' },
  { pattern: /^뭐\s*부모님도\s*있으니까\s*그런일은.*$/, replacement: 'ก็มีพ่อแม่อยู่ด้วย เรื่องแบบนั้นมันก็เลย--' },
  { pattern: /^일상이야\s*이모.*$/, replacement: 'เป็นเรื่องปกติครับคุณน้า' },
  { pattern: /^엉덩이가\s*너무\s*커서\s*방해돼.*$/, replacement: 'ก้นใหญ่เกินไปจนเกะกะจังนะ' },
  { pattern: /^엉덩이가\s*너무커서\s*방해돼.*$/, replacement: 'ก้นใหญ่เกินไปจนเกะกะจังนะ' },
  { pattern: /^하는\s*것뿐.*$/, replacement: 'ก็แค่ทำเท่านั้นเอง' },
  { pattern: /^하는것뿐.*$/, replacement: 'ก็แค่ทำเท่านั้นเอง' },
  { pattern: /^코토미가\s*제일\s*야하고\s*귀여우니까.*$/, replacement: 'เพราะโคโตมิทั้งลามกและน่ารักที่สุดเลยนี่นา' },
  { pattern: /^코토미가\s*제일야하고\s*귀여우니까.*$/, replacement: 'เพราะโคโตมิทั้งลามกและน่ารักที่สุดเลยนี่นา' },
  { pattern: /^나도\d*\s*떨어지고\s*싶지않아.*$/, replacement: 'ฉันเองก็ไม่อยากแยกจากไปเหมือนกัน' },
  { pattern: /^코토미\s*더\s*가버려.*$/, replacement: 'โคโตมิ เสร็จให้มากกว่านี้อีกสิ!' },
  { pattern: /^코토미\s*더가버려.*$/, replacement: 'โคโตมิ เสร็จให้มากกว่านี้อีกสิ!' },
  { pattern: /^코토미\s*엉덩이\s*야해서.*$/, replacement: 'เพราะก้นของโคโตมิมันลามกนี่นา' },
  { pattern: /^안물렸어.*$/, replacement: 'ไม่โดนกัดหรอก' },
  { pattern: /^너한$/, replacement: 'กับเธอ' },
  { pattern: /^너한테$/, replacement: 'กับเธอ' },
  { pattern: /^꼬맹이$/, replacement: 'เจ้าหนู' },
  { pattern: /^주제에뭐냐고이녀석$/, replacement: 'เป็นแค่... แต่ทำเป็นเก่งนะไอ้หมอนี่' },
  { pattern: /^주제에$/, replacement: 'เป็นแค่...แท้ๆ' },
  { pattern: /^뭐냐고이녀석$/, replacement: 'คิดว่าเป็นใครกันไอ้หมอนี่' },
  { pattern: /^개허접걸레년주제에나대지[마มา].*$/, replacement: 'อีผู้หญิงสำส่อนไม่ได้เรื่องเอ๊ย อย่ามาสะเออะ!' },
  { pattern: /^개허접걸레년$/, replacement: 'อีผู้หญิงสำส่อนไม่ได้เรื่อง' },
  { pattern: /^주제에나대지[마มา].*$/, replacement: 'อย่ามาสะเออะ!' },
  { pattern: /^이[압얍]이이[압얍]이$/, replacement: 'ยึบ ยึบ' },
  { pattern: /^이[압얍]이$/, replacement: 'ยึบ' },
  { pattern: /^거+거긴만지면$/, replacement: 'ตร-ตรงนั้นถ้าไปจับโดนเข้าล่ะก็' },
  { pattern: /^거긴만지면$/, replacement: 'ตรงนั้นถ้าไปจับโดนเข้าล่ะก็' },
  { pattern: /^만지면$/, replacement: 'ถ้าไปจับโดน...' },
  { pattern: /^같았는데$/, replacement: 'เหมือนว่า...แท้ๆ' },
  { pattern: /^꼬맹이라고거유녀랑재우니까불끈거린다고$/, replacement: 'หาว่าเป็นเด็ก แต่พอให้นอนกับสาวนมโตแล้วมันคึกจนแข็งเป๊กเลยนี่หว่า' },
  { pattern: /^꼬맹이라고$/, replacement: 'หาว่าเป็นเด็ก' },
  { pattern: /^거유녀랑$/, replacement: 'กับสาวนมโต' },
  { pattern: /^재우니까$/, replacement: 'พอให้นอนด้วย' },
  { pattern: /^불끈거린다고$/, replacement: 'มันคึกจนแข็งเป๊กเลยนี่หว่า' },
  { pattern: /^알면서$/, replacement: 'ทั้งที่รู้อยู่แท้ๆ' },
  { pattern: /^그걸로뭐하려고$/, replacement: 'จะเอาอันนั้นไปทำอะไรน่ะ' },
  { pattern: /^아무리그래도그건.*$/, replacement: 'ถึงอย่างนั้นก็เถอะ แบบนั้นมัน--!' },
  { pattern: /^그럴리가$/, replacement: 'ไม่มีทางหรอก' },
  { pattern: /^네엄마쉬워보이던[데เด].*$/, replacement: 'แม่ของเธอแลดูง่ายดีนี่นา เดี๋ยวจะสร้างน้องข้างๆ สามีให้ดูนะ' },
  { pattern: /^네엄마$/, replacement: 'แม่ของเธอ' },
  { pattern: /^쉬워보이던[데เด]$/, replacement: 'แลดูง่ายดีนี่นา' },
  { pattern: /^남편옆에서$/, replacement: 'ข้างๆ สามี' },
  { pattern: /^동생만들어줄게.*$/, replacement: 'เดี๋ยวจะสร้างน้องให้ดูนะ' },
  { pattern: /^갑자기어리광부리지말라고$/, replacement: 'จู่ๆ อย่ามาทำเป็นออดอ้อนนะ' },
  { pattern: /^갑자기$/, replacement: 'จู่ๆ' },
  { pattern: /^어리광$/, replacement: 'ออดอ้อน' },
  { pattern: /^부리지말라고$/, replacement: 'อย่ามาทำเป็น...นะ' },
  { pattern: /^마리코가$/, replacement: 'มาริโกะ' },
  { pattern: /^남편이랑$/, replacement: 'กับสามี' },
  { pattern: /^일주일\s*여행$/, replacement: 'เที่ยวหนึ่งสัปดาห์' },
  { pattern: /^일주일여행$/, replacement: 'เที่ยวหนึ่งสัปดาห์' },
  { pattern: /^가는\s*동안$/, replacement: 'ระหว่างที่ไป' },
  { pattern: /^가는동안$/, replacement: 'ระหว่างที่ไป' },
  { pattern: /^맡아달래서$/, replacement: 'วานให้ช่วยดูแล' },
  { pattern: /^예쁘다$/, replacement: 'สวยจัง' },
  { pattern: /^예뻐$/, replacement: 'สวย' },
  { pattern: /^그만해$/, replacement: 'หยุดนะ' },
  { pattern: /^그만해요$/, replacement: 'หยุดนะครับ' },
  { pattern: /^놔줘$/, replacement: 'ปล่อยฉันด้วย' },
  { pattern: /^기다려$/, replacement: 'รอก่อน' },
  { pattern: /^천천히$/, replacement: 'ช้าๆ หน่อย' },
  { pattern: /^조금만$/, replacement: 'นิดนึงก็ยังดี' },
  { pattern: /^나왔어$/, replacement: 'ออกมาแล้ว' },
  { pattern: /^들어가$/, replacement: 'เข้าไปเลย' },
  { pattern: /^나가$/, replacement: 'ออกไปเลย' },

  // Systemic Korean conversational stems & dialogue connectors
  { pattern: /^이대로$/, replacement: 'แบบนี้' },
  { pattern: /^이대로는$/, replacement: 'ถ้าเป็นแบบนี้ต่อไป' },
  { pattern: /^이대로가$/, replacement: 'ถ้าเป็นแบบนี้' },
  { pattern: /^네마음대로해$/, replacement: 'ทำตามใจเธอเลย' },
  { pattern: /^네마음대로$/, replacement: 'ตามใจเธอ' },
  { pattern: /^지금의나는$/, replacement: 'ตัวฉันในตอนนี้' },
  { pattern: /^나도앞으로도$/, replacement: 'ฉันเอง ต่อจากนี้ก็ด้วย' },
  { pattern: /^그렇지$/, replacement: 'ใช่ไหมล่ะ' },
  { pattern: /^하더라고$/, replacement: 'เขาว่างั้นนะ' },
  { pattern: /^아녜요$/, replacement: 'เปล่าหรอก' },
  { pattern: /^아뎨요$/, replacement: 'เปล่าหรอก' },
  { pattern: /^재밌는데$/, replacement: 'น่าสนุกดีนี่' },
  { pattern: /^으응$/, replacement: 'อืม?' },
  { pattern: /^계속좋아해준다는그약속만잘지켜준다면$/, replacement: 'ถ้าเธอยังคงรักษาสัญญาว่าจะชอบฉันตลอดไป...' },
  { pattern: /^계속좋아해준다는$/, replacement: 'ว่าจะชอบฉันตลอดไป' },
  { pattern: /^그약속만잘지켜준다면$/, replacement: 'ถ้าเธอยังคงรักษาสัญญานั้นไว้' },
  { pattern: /^사랑해$/, replacement: 'รักนะ' },
  { pattern: /^아니뭐$/, replacement: 'เปล่าหรอก แค่...' },
  { pattern: /^하아$/, replacement: 'เฮ้อ...' },
  { pattern: /^옛날의우리로선$/, replacement: 'สำหรับพวกเราในอดีต' },
  { pattern: /^하늘아$/, replacement: 'ฮานึล!' },
  { pattern: /^내말이$/, replacement: 'นั่นน่ะสิ!' },
  { pattern: /^말구$/, replacement: 'อย่า...' },
  { pattern: /^너무기대하진말구$/, replacement: 'อย่าคาดหวังเกินไปนะ' },
  { pattern: /^너무기대하진$/, replacement: 'อย่าคาดหวังเกินไป' },
  { pattern: /^지수가그럼자기랑도오래알았으니까깍지껴보자고그랬거든$/, replacement: 'จีซูบอกว่าไหนๆ ก็รู้จักกันมานานแล้ว เลยลองมากุมมือกันน่ะ' },
  { pattern: /^아무튼그래서$/, replacement: 'อย่างที่บอกไปว่า' },
  { pattern: /^아무튼$/, replacement: 'อย่างน้อยก็' },
  { pattern: /^그래서$/, replacement: 'เพราะฉะนั้น' },
  { pattern: /^그럼$/, replacement: 'ถ้าอย่างนั้น' },
  { pattern: /^그럼특별히$/, replacement: 'ถ้าอย่างนั้นเป็นพิเศษ' },
  { pattern: /^특별히$/, replacement: 'เป็นพิเศษ' },
  { pattern: /^살살해줄게$/, replacement: 'จะทำเบาๆ ให้' },
  { pattern: /^살살해줘$/, replacement: 'ทำเบาๆ หน่อยนะ' },
  { pattern: /^아니야$/, replacement: 'ไม่ใช่หรอก' },
  { pattern: /^아니에요$/, replacement: 'ไม่ใช่ครับ' },
  { pattern: /^어쩌지$/, replacement: 'ทำไงดี' },
  { pattern: /^어쩌면$/, replacement: 'บางที' },
  { pattern: /^그래$/, replacement: 'นั่นสิ' },
  { pattern: /^하지만$/, replacement: 'แต่ว่า' },
  { pattern: /^글쎄$/, replacement: 'นั่นสิอืม' },
  { pattern: /^벌써$/, replacement: 'เรียบร้อยแล้ว' },
  { pattern: /^그렇게$/, replacement: 'แบบนั้น' },
  { pattern: /^이렇게$/, replacement: 'แบบนี้' },

  // User requested Korean Manhwa dialogues and expressions
  { pattern: /^아니잠깐$/, replacement: 'เดี๋ยวก่อนสิ' },
  { pattern: /^그렇구나$/, replacement: 'อย่างนี้นี่เอง' },
  { pattern: /^좋아해요$/, replacement: 'ชอบนะคะ' },
  { pattern: /^어느새제가$/, replacement: 'ไม่ทันรู้ตัว ตัวฉันก็...' },
  { pattern: /^그러세요$/, replacement: 'เชิญเลยค่ะ' },
  { pattern: /^저를좋아하는지부터$/, replacement: 'เริ่มจากว่าชอบฉันหรือเปล่า' },
  { pattern: /^그걸지금$/, replacement: 'เรื่องนั้น ตอนนี้น่ะ...' },
  { pattern: /^말이라고하냐$/, replacement: 'พูดแบบนั้นออกมาได้ยังไง' },
  { pattern: /^그런짓까지다허락해놓고$/, replacement: 'ทั้งที่ยอมให้ทำเรื่องแบบนั้นไปหมดแล้วแท้ๆ' },
  { pattern: /^서도연하고나하고$/, replacement: 'ซอดอยอนกับฉัน' },
  { pattern: /^울언으읍+$/, replacement: 'อื้ออื๊บ!!' },
  { pattern: /^디진다진짜$/, replacement: 'เดี๋ยวตายจริงๆ แน่' },
  { pattern: /^널심란하게$/, replacement: 'ทำให้เธอว้าวุ่นใจ' },
  { pattern: /^안된다느니뭐니$/, replacement: 'บอกว่าไม่ได้บ้างล่ะ อะไรบ้างล่ะ' },
  { pattern: /^이[땅딴다]걸물어보고$/, replacement: 'มาถามเรื่องพรรค์นี้' },
  { pattern: /^하고싶은대로$/, replacement: 'ตามที่อยากทำ' },
  { pattern: /^생각해보면너$/, replacement: 'พอลองคิดดูแล้ว เธอ...' },
  { pattern: /^우리과에$/, replacement: 'ในสาขาของเรา' },
  { pattern: /^우리과사람들$/, replacement: 'คนในสาขาของเรา' },
  { pattern: /^예쁘고가슴큰년들은$/, replacement: 'พวกชะนีสวยๆ นมโตๆ' },
  { pattern: /^[죄최]다긁어모아서$/, replacement: 'กวาดมารวมกันหมด' },
  { pattern: /^연하늘은$/, replacement: 'ยอนฮานึลน่ะ' },
  { pattern: /^[너떠]가더잘알거고$/, replacement: 'เธอคงจะรู้ดีกว่าใคร' },
  { pattern: /^내내가바라는게$/, replacement: 'สิ่งที่ฉัน... ฉันต้องการ' },
  { pattern: /^수치스럽게$/, replacement: 'อย่างน่าอับอาย' },
  { pattern: /^웃기게들릴건$/, replacement: 'คงจะฟังดูตลกนะ' },
  { pattern: /^육체적인관계로만$/, replacement: 'แค่ความสัมพันธ์ทางกายเท่านั้น' },
  { pattern: /^자길좋아하냐고$/, replacement: 'ถามว่าชอบตัวเองหรือเปล่า' },
  { pattern: /^아니그런거$/, replacement: 'เปล่า ไม่ใช่เรื่องแบบนั้น' },
  { pattern: /^버린다든가$/, replacement: 'ทิ้งไป หรืออะไรแบบนั้น' },
  { pattern: /^그런살벌한$/, replacement: 'เรื่องที่น่ากลัวแบบนั้น' },
  { pattern: /^(기기적인해계지면프|기적적인|기적적인해결)$/, replacement: 'เรื่องมหัศจรรย์...' },
  { pattern: /^그다지좋다고$/, replacement: 'ไม่ได้บอกว่าชอบขนาดนั้น' },
  { pattern: /^그런유리선배를$/, replacement: 'รุ่นพี่ยูริแบบนั้น' },
  { pattern: /^뒤집어버리려던게$/, replacement: 'ที่ตั้งใจจะพลิกกลับกลายมาเป็น' },
  { pattern: /^진심으로$/, replacement: 'อย่างจริงใจ' },
  { pattern: /^좋아하게됐다는걸$/, replacement: 'กลายเป็นชอบเข้าจริงๆ' },
  { pattern: /^아시다시피저는$/, replacement: 'อย่างที่รู้กัน ตัวฉันน่ะ...' },
  { pattern: /^복종심을이용해서$/, replacement: 'อาศัยความยอมจำนน' },
  { pattern: /^좋아하라고강요하는듯$/, replacement: 'เหมือนบังคับให้ชอบ' },
  { pattern: /^양심적이어서$/, replacement: 'รู้สึกผิดชอบชั่วดี' },
  { pattern: /^연읍+$/, replacement: 'อื้ออื๊บ!!' },
  { pattern: /^탓읍+$/, replacement: 'ทัต... อึ้บ!!' },
  { pattern: /^참내$/, replacement: 'ให้ตายสิ' },
  { pattern: /^꽤핫플레이스인데$/, replacement: 'เป็นสถานที่ยอดฮิตเลยนะ' },
  { pattern: /^내가좋아하는사람이$/, replacement: 'คนที่ฉันชอบ' },
  { pattern: /^흔한일은아니잖아요$/, replacement: 'มันไม่ใช่เรื่องธรรมดาๆ ทั่วไปนี่ครับ' },
  { pattern: /^그런기적이왔는데도파민때문에놓치면$/, replacement: 'ปาฏิหาริย์แบบนั้นมาถึงแล้ว ถ้าต้องพลาดไปเพราะโดพามีนล่ะก็' },
  { pattern: /^그런기적이왔는데$/, replacement: 'ปาฏิหาริย์แบบนั้นมาถึงแล้ว' },
  { pattern: /^도파민때문에놓치면$/, replacement: 'ถ้าต้องพลาดไปเพราะโดพามีนล่ะก็' },
  { pattern: /^서로좋아하는기회를놓칠까봐걱정을해$/, replacement: 'กังวลว่าจะพลาดโอกาสที่จะได้ชอบพอกันงั้นเหรอ?' },
  { pattern: /^서로좋아하는기회를$/, replacement: 'โอกาสที่จะได้ชอบพอกัน' },
  { pattern: /^놓칠까봐걱정을해$/, replacement: 'กังวลว่าจะพลาดไปงั้นเหรอ?' },
  { pattern: /^이게$/, replacement: 'สิ่งนี้' },
  { pattern: /^너도마음이있어서$/, replacement: 'เธอก็มีใจเหมือนกัน' },
  { pattern: /^아니저는유리선배도$/, replacement: 'เปล่าครับ... สำหรับผม รุ่นพี่ยูริก็' },
  { pattern: /^그런짓예시$/, replacement: 'ตัวอย่างเรื่องแบบนั้น' },
  { pattern: /^조+조용히해요선배여기공원이에요$/, replacement: 'ชะ... เงียบๆ หน่อยครับรุ่นพี่! ที่นี่มันสวนสาธารณะนะ!' },
  { pattern: /^조+조용히해요선배$/, replacement: 'ชะ... เงียบๆ หน่อยครับรุ่นพี่!' },
  { pattern: /^여기공원이에요$/, replacement: 'ที่นี่มันสวนสาธารณะนะ!' },
  { pattern: /^네뭐$/, replacement: 'คะ? อะไรนะ...' },
  { pattern: /^하게해드려야지별수있나$/, replacement: 'ก็ต้องยอมให้ทำล่ะนะ จะมีทางเลือกอื่นได้ยังไง' },
  { pattern: /^예뭐그건부부나연인들이야기아니에요$/, replacement: 'ใช่ เอ่อ... นั่นมันเรื่องของสามีภรรยาหรือคู่รักไม่ใช่เหรอครับ?' },
  { pattern: /^에휴$/, replacement: 'เฮ้อ...' },
  { pattern: /^그연인같은섹스를$/, replacement: 'เซ็กส์ที่เหมือนคู่รักแบบนั้น' },
  { pattern: /^제이기심을받아들여줘서그연인같은섹스를$/, replacement: 'ที่ยอมรับความเห็นแก่ตัวของฉัน... เซ็กส์ที่เหมือนคู่รักแบบนั้น' },
  { pattern: /^제이기심을받아들여줘서$/, replacement: 'ที่ยอมรับความเห็นแก่ตัวของฉัน' },
  { pattern: /^나를좋아하는게$/, replacement: 'การที่ชอบฉัน' },
  { pattern: /^나를좋아하는$/, replacement: 'ที่ชอบฉัน' },
  { pattern: /^예\?*유리선배\?*$/, replacement: 'ใช่เหรอครับ? รุ่นพี่ยูริ?' },
  { pattern: /^예유리선배$/, replacement: 'ใช่เหรอครับ? รุ่นพี่ยูริ?' },
  { pattern: /^이건데$/, replacement: 'คืออันนี้เหรอ...?' },

  // Manhwa Dialogue & Phrases Patterns (Adaptable)
  { pattern: /^쿠기사키제대로쪼여란?$/, replacement: 'คุกิซากิ ขมิบแน่นๆ เข้าสิ' },
  { pattern: /^쿠기사키꾸물대지$/, replacement: 'คุกิซากิ อย่ามัวชักช้าสิ' },
  { pattern: /^가슴압착하구만자포상이다$/, replacement: 'บดขยี้หน้าอกได้ดีนี่ เอาล่ะ นี่คือรางวัล' },
  { pattern: /^가슴압착하구만$/, replacement: 'บดขยี้หน้าอกได้แนบแน่นดีนี่' },
  { pattern: /^아아젠장자지냄새로흥분해서$/, replacement: 'อ๊า ให้ตายสิ ดันมีอารมณ์เพราะกลิ่นดุ้นเนี่ยนะ' },
  { pattern: /^이녀석들의기억하고$/, replacement: 'จำเรื่องของเจ้าพวกนี้เอาไว้' },
  { pattern: /^드디어좀제대로하는구만쿠기사키$/, replacement: 'ในที่สุดก็ทำได้เรื่องขึ้นมาหน่อยแล้วสินะ คุกิซากิ' },
  { pattern: /^임신해[릿라]?쿠기사키임신[해에]+!*$/, replacement: 'ท้องซะ คุกิซากิ ท้องซะะะ!' },
  { pattern: /^착실히노브라로두모라도등교하다니기특하지만$/, replacement: 'อุตส่าห์ตั้งใจมาโรงเรียนแบบโนบราแท้ๆ ถึงจะน่ายกย่องอยู่หรอก แต่...' },
  { pattern: /^지도랍시고노브라로등교해라성희롱을받아들여라제멋대로$/, replacement: 'อ้างว่าเป็นการสั่งสอน ให้มาโรงเรียนแบบโนบรา ยอมรับการลวนลาม ทำตามอำเภอใจ' },
  { pattern: /^애정도없는야하기만한[딥딩]키스$/, replacement: 'จูบดูดดื่มที่มีแต่ความลามกโดยไร้ซึ่งความรัก' },
  { pattern: /^교사랑학생이해도될키스가아니야$/, replacement: 'ไม่ใช่จูบที่ครูกับนักเรียนควรทำกันนะ' },
  { pattern: /^고약하구만꼬맹이특유의달달하고음탕한암내$/, replacement: 'ร้ายกาจจริงนะ กลิ่นสาบสาวอันร่านรักและหอมหวานเฉพาะตัวของยัยเด็กนี่' },
  { pattern: /^쿠기사키이런음란한냄새를풍기며수업을받을수있을줄알았냐\??$/, replacement: 'คุกิซากิ คิดว่าจะมานั่งเรียนทั้งที่ส่งกลิ่นลามกแบบนี้ได้งั้นเหรอ?' },
  { pattern: /^욕정을불러일으키는단순한애무$/, replacement: 'การเล้าโลมธรรมดาๆ ที่ปลุกเร้าตัณหาราคะ' },
  { pattern: /^지각전에등교했는데.*$/, replacement: 'อุตส่าห์มาโรงเรียนก่อนเวลาแท้ๆ' },
  { pattern: /^어른을유혹하는음란녀로[우음]라년?로태어났으니$/, replacement: 'ก็เกิดมาเป็นผู้หญิงร่านที่คอยยั่วผู้ใหญ่นี่นา' },
  { pattern: /^이자식들은여자를그저임신주머니로$/, replacement: 'เจ้าพวกเวรนี่มองผู้หญิงเป็นแค่ถุงผลิตลูกเท่านั้น' },
  { pattern: /^네가탈선을하지않기위한!*$/, replacement: 'เพื่อไม่ให้เธอเตลิดออกนอกลู่นอกทางยังไงล่ะ!' },
  { pattern: /^맛있다는[촛씨]물즙을빨아대는$/, replacement: 'คอยดูดกลืนน้ำกามราวกับเอร็ดอร่อย' },
  { pattern: /^건방진반항기꼬맹이라도$/, replacement: 'แม้จะเป็นยัยเด็กอวดดีในวัยต่อต้านก็ตาม' },
  { pattern: /^몸뚱아리는솔직한게귀엽구만~*$/, replacement: 'แต่ร่างกายกลับซื่อตรง น่ารักดีนี่~' },
  { pattern: /^좋아아아아오윽이각도로$/, replacement: 'ดีล่ะะะ อ๊าาอึ่ก ที่มุมนี้แหละ' },
  { pattern: /^모델로스카우트연예계라던가$/, replacement: 'แมวมองทาบทามไปเป็นนางแบบในวงการบันเทิงหรืออะไรทำนองนั้น' },
  { pattern: /^쿠기사키가슴더보여줘$/, replacement: 'คุกิซากิ โชว์หน้าอกให้ดูมากกว่านี้หน่อยสิ' },
  { pattern: /^초등학생땐선머슴같았는데$/, replacement: 'ตอนอยู่ประถมยังดูเหมือนทอมบอยอยู่แท้ๆ' },
  { pattern: /^쿠기사키가낯짝으로유혹하고$/, replacement: 'คุกิซากิยั่วยวนด้วยสีหน้าแบบนั้น' },
  { pattern: /^남자들은쫄아서[섹세]스까진안하니까$/, replacement: 'พวกผู้ชายมันปอดแหก ไม่กล้าทำไปถึงขั้นมีเซ็กส์หรอก' },
  { pattern: /^아-?진짜망할교장의엄청찐한$/, replacement: 'อา จริงๆ เลย น้ำของตาผอ. สารเลวที่เข้มข้นสุดๆ' },
  { pattern: /^자궁까지쥬룹쥬룹맛있다는듯삼키고있어$/, replacement: 'ดูดกลืนจ๊วบๆ ลึกเข้าไปถึงในมดลูกราวกับเอร็ดอร่อย' },
  { pattern: /^이개변태'?노바라우기를$/, replacement: 'ไอ้โรคจิตขั้นสุดนี่ โนบาระพวกเรา...' },
  { pattern: /^꼬맹이이놈들이저항하지내몸을않는다고멋대로해서$/, replacement: 'เจ้าเด็กพวกนี้ พอเห็นว่าฉันไม่ขัดขืนก็ทำตามใจชอบกับร่างกายฉันซะได้' },
  { pattern: /^꼬맹이이놈들이저항하지않는다고내몸을멋대로해서$/, replacement: 'เจ้าเด็กพวกนี้ พอเห็นว่าฉันไม่ขัดขืนก็ทำตามใจชอบกับร่างกายฉันซะได้' },
  { pattern: /^남자애의체중으로유선을찌부러뜨려$/, replacement: 'บดขยี้ต่อมน้ำนมด้วยน้ำหนักตัวของเด็กผู้ชาย' },
  { pattern: /^빠따로사악한음란자궁때려맞아$/, replacement: 'กระหน่ำฟาดมดลูกอันร่านรักด้วยไม้เบสบอล' },
  { pattern: /^자지구[멍용]처+맞아서$/, replacement: 'โดนกระแทกซัดเข้าไปในรูเสียบดุ้น' },
  { pattern: /^정의쩔어개변태괴수패배해버려어?$/, replacement: 'ความยุติธรรมอันสุดยอด สัตว์ประหลาดจอมลามกจงพ่ายแพ้ไปซะ!' },
  { pattern: /^오+'?노바라이정도론우[리기ก]를얕보지.*$/, replacement: 'โอ้ โนบาระ แค่นี้อย่ามาดูถูกพวกเรานะ' },
  { pattern: /^개변태괴수'?노바라우[리ก]를쓰러뜨렸다!*$/, replacement: 'โค่นล้มสัตว์ประหลาดจอมลามกโนบาระได้แล้ว!!' },
  { pattern: /^아아오\??이거최고로비참하고기분'?좋아아$/, replacement: 'อ๊าา นี่มันทั้งน่าสมเพชที่สุดแต่กลับรู้สึกดีชะมัดดด' },
  { pattern: /^엉망진창이돼버려서$/, replacement: 'จนกลายเป็นเละเทะไม่เป็นท่าไปซะแล้ว' },
  { pattern: /^사오리[상쌍]을그런꼴로놈들과$/, replacement: 'กับพวกที่ทำกับซาโอริซังในสภาพแบบนั้น' },
  { pattern: /^자궁으로문질러라$/, replacement: 'ถูไถเข้าไปด้วยมดลูกสิ' },
  { pattern: /^나오고있어질내사정당해서$/, replacement: 'มันกำลังไหลทะลักออกมา เพราะโดนแตกในเข้าไป' },
  { pattern: /^고약해고약해$/, replacement: 'ร้ายกาจจริงๆ ร้ายกาจชะมัด' },
  { pattern: /^빠는걸멈출수가$/, replacement: 'หยุดดูดไม่ได้เลย...' },
  { pattern: /^진해이!?어제처럼묵직하고진한[촛씨]물$/, replacement: 'เข้มข้นสุดๆ! น้ำกามที่ทั้งข้นคลั่กและหนักแน่นเหมือนเมื่อวาน' },
  { pattern: /^[제젠]장[제젠]장아니냐고$/, replacement: 'ให้ตายสิ บ้าไปแล้วไม่ใช่หรือไง' },
  { pattern: /^용서못해이개자식들$/, replacement: 'ไม่ยกโทษให้แน่ เจ้าพวกระยำเอ๊ย' },
  { pattern: /^후장구멍에박힌빠따빙글빙글휘저어서혼[쫓쭐]나고$/, replacement: 'เอาไม้เบสบอลเสียบคารูตูดแล้วหมุนคว้างกวนไปมาจนแทบสิ้นสติ' },
  { pattern: /^노바라또놀자-?르-?가$/, replacement: 'โนบาระ ไว้มาเล่นกันใหม่อีกนะ' },
  { pattern: /^러져-?$/, replacement: 'บี้แบนไปหมดแล้ว-' },

  // Author's Afterword patterns
  { pattern: /^일단전편이란생각으로그렸습니다$/, replacement: 'ในเบื้องต้นวาดขึ้นมาโดยกะให้เป็นตอนแรกครับ' },
  { pattern: /^속편네임도있지만글[세쎄]요$/, replacement: 'ถึงจะมีเนมของภาคต่ออยู่บ้างแต่ก็ยังไม่แน่ใจครับ' },
  { pattern: /^완성직후라이책이꼴리는지어떤지$/, replacement: 'เพิ่งวาดเสร็จหมาดๆ เลยยังไม่รู้ว่าเล่มนี้จะกระตุ้นอารมณ์ได้แค่ไหน' },
  { pattern: /^모르는상태라[크속]?속편을그릴지는$/, replacement: 'ยังไม่รู้แน่ชัดว่าจะได้วาดภาคต่อไหม' },
  { pattern: /^모르겠습니다$/, replacement: 'ยังไม่ทราบแน่นอนครับ' },
  { pattern: /^내용면에선꽤평범해졌구나$/, replacement: 'ในแง่ของเนื้อหาดูจะธรรมดาไปหน่อย' },
  { pattern: /^더격렬하게하면좋았을텐데$/, replacement: 'ถ้าทำออกมาให้ดุเดือดกว่านี้ก็น่าจะดีแท้ๆ' },
  { pattern: /^이것저것우겨넣지않으려고$/, replacement: 'ถึงแม้จะพยายามไม่ยัดเยียดอะไรหลายๆ อย่าง' },
  { pattern: /^노력하고있지만$/, replacement: 'กำลังพยายามอยู่ครับ' },
  { pattern: /^다음엔하나의플레이를$/, replacement: 'คราวหน้าคงจะเน้นเพลย์แบบเดี่ยวๆ' },
  { pattern: /^자세하게$/, replacement: 'อย่างละเอียดลึกซึ้ง' },
  { pattern: /^[|]?그리도록$/, replacement: 'ในการวาด' },
  { pattern: /^해야지$/, replacement: 'ต้องทำอย่างนั้นแล้วล่ะ' },
  { pattern: /^네임이쌓여서작품을팍팍$/, replacement: 'อยากสะสมเนมแล้วทยอยปล่อยผลงานใหม่ออกมารัวๆ' },
  { pattern: /^내[범임]이들여지식품들력력$/, replacement: 'อยากปล่อยผลงานใหม่ออกมารัวๆ' },
  { pattern: /^내야겠다~?라고생각중입니다$/, replacement: 'กำลังคิดว่าจะปล่อยผลงานออกมาครับ' },
  { pattern: /^지원사이트등에도$/, replacement: 'ทางเว็บไซต์ซัพพอร์ต' },
  { pattern: /^응원해주시면기쁘겠습니다$/, replacement: 'ถ้าช่วยสนับสนุนและให้กำลังใจจะยินดีเป็นอย่างยิ่งครับ' },
];

export const normalizeKoreanColloquialOcrText = (text: string): string => {
  let normalized = String(text || '');
  normalized = normalized
    .replace(/。/g, '. ')
    .replace(/、/g, ', ')
    .replace(/！/g, '! ')
    .replace(/？/g, '? ')
    .replace(/〜/g, '~')
    .replace(/([.,!?…])(?=[\uAC00-\uD7AF])/g, '$1 ');

  KOREAN_COLLOQUIAL_REPAIRS.forEach(({ pattern, replacement }) => {
    normalized = normalized.replace(pattern, replacement);
  });

  return normalizeWhitespace(normalized);
};

export const isBoilerplateHallucination = (sourceText: string, translatedText: string): boolean => {
  const source = String(sourceText || '').toLowerCase();
  const translated = String(translatedText || '').toLowerCase();

  // If the source text contains Hangul (Korean), Kana (Japanese), or Han (Chinese)
  const isCjkSource = /[\uAC00-\uD7AF\u3040-\u30FF\u4E00-\u9FFF]/.test(sourceText);
  if (!isCjkSource) return false;

  // List of common boilerplate terms that are frequently hallucinated by Argos
  const boilerplateTerms = [
    'เกี่ยวกับเรา',
    'เงื่อนไขการบริการ',
    'นโยบายความเป็นส่วนตัว',
    'ข้อตกลงในการให้บริการ',
    'ผมตกลงในเงื่อนไข',
    'ฉันตกลงในเงื่อนไข',
    'ข้อมูลส่วนบุคคล',
    'ถ้าคุณมีคำถาม',
    'โปรดติดต่อเรา',
    'โปรดติดต่อ',
    'ติดต่อเรา',
    'คำถามที่พบบ่อย',
    'ศูนย์ช่วยเหลือ',
    'ข้อกำหนดและเงื่อนไข',
  ];

  // If the source doesn't actually mean "about us" or "terms of service", but translation contains it
  // Common Korean words for about us / terms of service are: "회사 소개", "이용 약관", "개인정보 처리방침"
  const isActualBoilerplateSource = /회사\s*소개|이용\s*약관|개인정보|서비스\s*약관/.test(sourceText);

  if (!isActualBoilerplateSource) {
    return boilerplateTerms.some(term => translated.includes(term));
  }
  return false;
};

export const applyKoreanConversationalFallback = (
  sourceText: string,
  translatedText: string
): string | null => {
  const source = normalizeWhitespace(sourceText);
  if (!source || !KOREAN_HANGUL_REGEX.test(source)) return null;

  // Handle Thai OCR residual mixed into Korean text (e.g. "มดลูก 찌부러져-")
  if (/[\u0E00-\u0E7F]/.test(source)) {
    const hangulPart = source.replace(/[^\uAC00-\uD7AF]/g, '');
    if (hangulPart === '찌부러져' || hangulPart.startsWith('찌부러')) {
      if (source.includes('มดลูก')) {
        return 'มดลูกโดนบี้แบนไปหมดแล้ว-';
      }
      return 'บี้แบนไปหมดแล้ว-';
    }
  }

  const compactSource = source.replace(/[\s.!?~,\u002D\u2010-\u2015\u2212\u00AD\u2026…♡♥'"’“”]+/g, '');
  const matched = KOREAN_CONVERSATIONAL_FALLBACKS.find((entry) => entry.pattern.test(compactSource));
  if (!matched) return null;

  return preserveSourceTrailingPunctuation(source, matched.replacement);
};

export const getKoreanTranslationScriptStats = (text: string): {
  hangulChars: number;
  thaiChars: number;
  latinChars: number;
  letterChars: number;
  hangulRatio: number;
  thaiRatio: number;
  latinRatio: number;
} => {
  const normalized = normalizeWhitespace(text);
  const hangulChars = (normalized.match(/\p{Script=Hangul}/gu) || []).length;
  const thaiChars = (normalized.match(KOREAN_THAI_REGEX) || []).length;
  const latinChars = (normalized.match(KOREAN_LATIN_REGEX) || []).length;
  const letterChars = hangulChars + thaiChars + latinChars;
  return {
    hangulChars,
    thaiChars,
    latinChars,
    letterChars,
    hangulRatio: hangulChars / Math.max(1, letterChars),
    thaiRatio: thaiChars / Math.max(1, letterChars),
    latinRatio: latinChars / Math.max(1, letterChars),
  };
};

export const hasKoreanTranslationCarryover = (text: string): boolean => {
  const stats = getKoreanTranslationScriptStats(text);
  return stats.hangulChars > 0 && stats.thaiChars === 0;
};

export const shouldPreferKoreanPivotTranslation = (
  sourceText: string,
  directText: string,
  pivotText: string
): boolean => {
  const source = normalizeWhitespace(sourceText);
  const direct = normalizeWhitespace(directText);
  const pivot = normalizeWhitespace(pivotText);

  if (!pivot) return false;
  if (!direct) return true;

  const directStats = getKoreanTranslationScriptStats(direct);
  const pivotStats = getKoreanTranslationScriptStats(pivot);
  if (pivotStats.thaiChars === 0) return false;

  if (directStats.thaiChars === 0 && directStats.latinChars > 0) return true;
  if (pivotStats.thaiChars > directStats.thaiChars + 1) return true;
  if (pivotStats.thaiRatio >= directStats.thaiRatio + 0.04) return true;
  if (directStats.latinRatio >= 0.18 && pivotStats.latinRatio + 0.05 < directStats.latinRatio) {
    return true;
  }

  const sourceKey = buildComparisonKey(source);
  const directKey = buildComparisonKey(direct);
  const pivotKey = buildComparisonKey(pivot);
  if (sourceKey && directKey && sourceKey === directKey && pivotKey !== sourceKey) {
    return true;
  }

  return false;
};