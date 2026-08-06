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
  const punctuation = String(sourceText || '').trim().match(/([.!?…\u002D\u2010-\u2015\u2212\u00AD]+)$/)?.[1] || '';
  const cleanReplacement = normalizeWhitespace(String(replacement || '')).replace(/[.!?…\u002D\u2010-\u2015\u2212\u00AD]+$/g, '').trim();
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
  { pattern: /^예쁘다$/, replacement: 'สวยจัง' },
  { pattern: /^예뻐$/, replacement: 'สวย' },
  { pattern: /^그만해$/, replacement: 'หยุดนะ' },
  { pattern: /^그만해요$/, replacement: 'หยุดนะครับ' },
  { pattern: /^놔줘$/, replacement: 'ปล่อยฉันด้วย' },
  { pattern: /^기다려$/, replacement: 'รอก่อน' },
  { pattern: /^천천히$/, replacement: 'ช้าๆ หน่อย' },
  { pattern: /^조금만$/, replacement: 'นิดนึงก็ยังดี' },
  { pattern: /^다왔어$/, replacement: 'ถึงแล้ว' },
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
];

export const normalizeKoreanColloquialOcrText = (text: string): string => {
  let normalized = String(text || '');
  normalized = normalized
    .replace(/。/g, '. ')
    .replace(/、/g, ', ')
    .replace(/！/g, '! ')
    .replace(/？/g, '? ')
    .replace(/〜/g, '~');

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

  const compactSource = source.replace(/[\s.!?~,\u002D\u2010-\u2015\u2212\u00AD]/g, '');
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