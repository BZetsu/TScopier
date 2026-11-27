import type { LegalDocumentPageTranslations } from './types'
import { legalContactTr } from './contactTr'

export const termsOfServiceTr: LegalDocumentPageTranslations = {
  title: 'Hizmet Şartları',
  lastUpdated: 'Son güncelleme: 8 Haziran 2026',
  intro:
    'İşbu Hizmet Şartları ("Şartlar"), Tartarix, Inc. ("Tartarix", "biz", "bize" veya "bizim") tarafından işletilen UniCopier web sitelerine, uygulamalarına ve ilgili hizmetlere (topluca "Hizmet") erişiminizi ve kullanımınızı düzenler. Bir hesap oluşturarak veya Hizmeti kullanarak bu Şartları kabul etmiş olursunuz. Kabul etmiyorsanız Hizmeti kullanmayın.',
  sections: [
    {
      title: '1. Ehliyet ve hesap',
      paragraphs: [
        'En az 18 yaşında (veya yetki alanınızda reşit olma yaşında) olmanız ve bağlayıcı bir sözleşme yapabilecek durumda olmanız gerekir. Giriş bilgilerinizin gizliliğini korumaktan ve hesabınız altında yürütülen tüm faaliyetlerden siz sorumlusunuz.',
        'Doğru kayıt bilgileri sağlamanız ve bunları güncel tutmanız gerekir. Sahtecilik yapan, kötüye kullanan veya bu Şartları ihlal eden hesapları askıya alabilir veya sonlandırabiliriz.',
      ],
    },
    {
      title: '2. Hizmet',
      paragraphs: [
        'UniCopier, kullanıcıların MetaTrader hesaplarını Telegram sinyal kanallarına bağlamasına ve kullanıcı yapılandırmasına göre işlem kopyalama iş akışlarını otomatikleştirmesine yardımcı olan bir yazılım aracıdır. Biz bir broker, borsa, saklayıcı, yatırım danışmanı veya portföy yöneticisi değiliz.',
        'Sizin adınıza kendi hesabımıza işlem yürütmüyor, fonlarınızı saklamıyoruz veya kişiye özel finansal tavsiye vermiyoruz. Tüm işlemler, kendi şartlarına tabi olan üçüncü taraf broker platformlarında gerçekleşir.',
      ],
    },
    {
      title: '3. Yatırım tavsiyesi yoktur',
      paragraphs: [
        'Hizmet aracılığıyla sağlanan bilgiler — sinyal metni, analizler, backtest ve dokümantasyon dahil — yalnızca bilgilendirme ve operasyonel amaçlıdır. Hiçbir içerik herhangi bir enstrümanın alınması veya satılması yönünde tavsiye niteliği taşımaz.',
        'Herhangi bir sinyali kopyalayıp kopyalamayacağınıza, hangi kanalları takip edeceğinize ve riski nasıl ölçeceğinize yalnızca siz karar verirsiniz. Geçmiş performans gelecekteki sonuçları garanti etmez.',
      ],
    },
    {
      title: '4. Sorumluluklarınız',
      paragraphs: [
        'İşlem kararlarınız, vergi yükümlülükleriniz, mevzuata uygunluğunuz ve brokerinizin şartlarına uygunluğunuzdan yalnızca siz sorumlusunuz. Kopyalanan işlemleri ve hesabınızı her zaman denetlemek zorundasınız.',
        'Hizmeti yasa dışı faaliyet, piyasa manipülasyonu, yetkisiz erişim, tersine mühendislik, makul olmayan hızlarda veri toplama veya diğer kullanıcılarla ya da altyapıyla müdahale etmek amacıyla kullanmayacaksınız.',
        'Bağladığınız herhangi bir Telegram kanalına ve broker hesabına bağlanma hakkına sahip olduğunuzu ve kullanımınızın üçüncü taraf haklarını veya anlaşmalarını ihlal etmediğini beyan edersiniz.',
      ],
    },
    {
      title: '5. Abonelikler ve faturalama',
      paragraphs: [
        'Ücretli özellikler aktif bir abonelik gerektirir. Ücretler, faturalama döngüleri ve plan sınırları ödeme sırasında ve uygulamada açıklanır. Ödemeler ödeme sağlayıcımız (örneğin Stripe) tarafından işlenir. Sunucularımızda tam ödeme kartı numaraları saklamayız.',
        'Kanunen gerekli olmadıkça veya satın alma sırasında aksi belirtilmedikçe abonelik ücretleri iade edilemez. Fiyatları önceden bildirimle değiştirebiliriz; yürürlük tarihinden sonra kullanıma devam etmek kabul anlamına gelir.',
      ],
    },
    {
      title: '6. Üçüncü taraf hizmetleri',
      paragraphs: [
        'Hizmet; brokerler (MetaTrader bağlantı API’leri üzerinden), Telegram, Supabase, analiz sağlayıcıları ve ödeme işlemcileri dahil üçüncü taraflarla entegre olur. Bu hizmetlerin kullanımı, kendi ayrı şartlarına ve gizlilik politikalarına tabidir.',
        'Üçüncü taraflardan kaynaklanan kesintiler, hatalar veya politika değişikliklerinden — kaçırılan sinyaller, başarısız emirler veya bir broker tarafından uygulanan hesap kısıtlamaları dahil — sorumlu değiliz.',
      ],
    },
    {
      title: '7. Fikri mülkiyet',
      paragraphs: [
        'Hizmet; yazılım, marka ve dokümantasyon dahil olmak üzere Tartarix veya lisans verenlerine aittir ve fikri mülkiyet kanunlarıyla korunur. Hesabınız iyi durumda olduğu sürece Hizmeti kişisel veya dahili ticari amaçlarınızla kullanmanız için size sınırlı, münhasır olmayan ve devredilemez bir lisans veriyoruz.',
        'Açıkça izin verilmedikçe Hizmeti kopyalayamaz, değiştiremez, dağıtamaz, satamaz veya türev eserler oluşturamazsınız.',
      ],
    },
    {
      title: '8. Sorumluluk reddi',
      paragraphs: [
        'HİZMET, AÇIK, ZIMNİ VEYA KANUNİ GARANTİLER DAHİL OLMAK ÜZERE HERHANGİ BİR TÜRDE GARANTİ OLMADAN "OLDUĞU GİBİ" VE "ERİŞİLEBİLİR OLDUĞU BİÇİMDE" SUNULMAKTADIR; TİCARİ ELVERİŞLİLİK, ÖZEL BİR AMACA UYGUNLUK VE HAKLARI İHLAL ETMEME GARANTİLERİ DAHİLDİR.',
        'Kesintisiz, güvenli veya hatasız çalışmayı, doğru sinyal ayrıştırmayı veya kopyalamanın belirli bir sonuç elde edeceğini garanti etmiyoruz.',
      ],
    },
    {
      title: '9. Sorumluluk sınırı',
      paragraphs: [
        'KANUNUN İZİN VERDİĞİ EN GENİŞ KAPSAMDA, TARTARIX VE YÖNETİCİLERİ, YÖNETİM KURULU ÜYELERİ, ÇALIŞANLARI VE TEDARİKÇİLERİ, HİZMETİ KULLANIMINIZDAN KAYNAKLANAN HERHANGİ BİR DOLAYLI, ARİZİ, ÖZEL, SONUÇSAL VEYA CEZA NİTELİNDEKİ ZARARDAN VEYA KÂR, VERİ, İTİBAR VEYA İŞLEM KAYIPLARININ HERHANGİ BİR KAYBINDAN SORUMLU OLMAYACAKTIR.',
        'BU ŞARTLAR VEYA HİZMET KAYNAKLI HERHANGİ BİR TALEP KARŞISINDAKİ TOPLAM SORUMLULUĞUMUZ, (A) TALEPTEN ÖNCEKİ ON İKİ (12) AY İÇİNDE BİZE ÖDEDİĞİNİZ TUTARLA (B) YÜZ AMERİKAN DOLARINDAN (USD $100) BÜYÜK OLAN TUTARI AŞMAYACAKTIR.',
      ],
    },
    {
      title: '10. Tazmin',
      paragraphs: [
        'Hizmeti kullanımınız, işlem faaliyetiniz, bu Şartları ihlal etmeniz veya herhangi bir kanunu ya da üçüncü taraf hakkını ihlal etmenizden doğan talepler, zararlar ve masraflara (makul avukatlık ücretleri dahil) karşı Tartarix’i savunmaya, tazmin etmeye ve zararsız tutmaya söz verirsiniz.',
      ],
    },
    {
      title: '11. Fesih',
      paragraphs: [
        'Hizmeti istediğiniz zaman kullanmayı bırakabilirsiniz. Bu Şartları ihlal etmeniz, kanunen gerekli olması veya Hizmeti sonlandırmamız hâlinde erişimi askıya alabilir veya sonlandırabiliriz.',
        'Doğası gereği fesih sonrası da devam etmesi gereken bölümler (sorumluluk reddi, sorumluluk sınırı ve tazmin dahil) fesih sonrasında da geçerli kalır.',
      ],
    },
    {
      title: '12. Uyuşmazlık çözümü',
      paragraphs: [
        'Resmi bir uyuşmazlık açmadan önce disputes@tscopier.ai adresine başvurun ve sorunun resmi olmayan biçimde çözülmesi için makul bir süre tanıyın.',
        'İşbu Şartlar, çakışma kanunu kuralları göz ardı edilerek ABD’nin Delaware eyaleti kanunlarına tabidir. Yasak olmadığı sürece, bu Şartlarla veya Hizmetle ilgili uyuşmazlıklarda münhasır yargılama yerinin Delaware’de bulunan eyalet veya federal mahkemeler olduğunu kabul edersiniz ve bu mahkemelerde kişisel yargı yetkisine rıza gösterirsiniz.',
      ],
    },
    {
      title: '13. Değişiklikler',
      paragraphs: [
        'İşbu Şartları zaman zaman güncelleyebiliriz. Revize edilmiş sürümü yeni bir "Son güncelleme" tarihiyle yayımlarız. Önemli değişiklikler ayrıca e-posta veya uygulama içi bildirimle duyurulabilir. Değişiklikler yürürlüğe girdikten sonra kullanıma devam etmek kabul anlamına gelir.',
      ],
    },
  ],
  closing:
    'Bu Şartlar hakkında sorularınız varsa legal@tscopier.ai adresine yazın.',
  contact: legalContactTr,
}
