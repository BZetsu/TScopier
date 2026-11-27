import type { LegalDocumentPageTranslations } from './types'
import { legalContactTr } from './contactTr'

export const cookiePolicyTr: LegalDocumentPageTranslations = {
  title: 'Çerez Politikası',
  lastUpdated: 'Son güncelleme: 8 Haziran 2026',
  intro:
    'Bu Çerez Politikası, Tartarix, Inc. ("biz", "bize" veya "bizim") tarafından UniCopier web sitelerinde ve uygulamalarda çerezlerin ve benzeri teknolojilerin nasıl kullanıldığını açıklar. Gizlilik Politikamız ile birlikte okunmalıdır.',
  sections: [
    {
      title: '1. Çerezler nedir?',
      paragraphs: [
        'Çerezler, bir web sitesini ziyaret ettiğinizde cihazınızda saklanan küçük metin dosyalarıdır. Benzeri teknolojiler arasında yerel depolama, oturum depolama ve pikseller yer alır. Bunlar sitelerin tercihleri hatırlamasına, oturumunuzu açık tutmasına ve Hizmetin nasıl kullanıldığını anlamasına yardımcı olur.',
      ],
    },
    {
      title: '2. Çerezleri nasıl kullanıyoruz',
      paragraphs: [
        'Zorunlu çerezler: kimlik doğrulama, güvenlik, yönlendirme atfı ve temel işlevler için gereklidir (örneğin oturum durumu; yapılandırıldığı yerde alt alanlar arası kimlik doğrulama varlığı). Hizmeti kullanırken devre dışı bırakılamazlar.',
        'Tercih çerezleri: dil, çerez onayı durumu ve kapatılmış bildirim çubukları gibi seçenekleri hatırlar.',
        'Analiz çerezleri: bildirim çubuğumuzda çerezleri kabul ettiğinizde, trafiği ve özellik kullanımını anlamak için Google Analytics ve ilgili tanımlayıcıları kullanabiliriz. Analiz olayları sayfa yolları, yönlendirme kodları ve takma adlı kimlikler içerebilir — broker parolalarınız veya işlem talimatlarınız değil.',
      ],
    },
    {
      title: '3. Yerleştirdiğimiz çerezler',
      paragraphs: [
        'Örnekler: kimlik doğrulama/oturum çerezleri kimlik doğrulama sağlayıcımızdan; tsc_tracking_consent ve tsc_tracking_seen_ts (çerez bildirim çubuğundaki seçiminiz); tsc_analytics_id (analiz çalıştığında takma adlı analiz kimliği); tsc_ref ve tsc_ref_ts (yönlendirme atfı); tsc_auth (etkinleştirildiğinde kısa ömürlü alt alanlar arası giriş ipucu).',
        'Adlar ve ömürler, Hizmeti geliştirdikçe değişebilir. Zorunlu çerezler genellikle oturumunuzu kapattığınızda veya tanımlı bir güvenlik süresinin ardından sona erer.',
      ],
    },
    {
      title: '4. Üçüncü taraf çerezleri',
      paragraphs: [
        'Google (Analytics), Stripe (ödeme) ve barındırma sağlayıcılarımız gibi üçüncü taraflar, özellikleriyle etkileşime girdiğinizde kendi çerezlerini yerleştirebilir. Bunların kullanımı kendi politikalarına tabidir.',
      ],
    },
    {
      title: '5. Seçenekleriniz',
      paragraphs: [
        'İlk ziyaretinizde çerez bildirim çubuğumuz, zorunlu olmayan izlemeyi kabul etmenize veya reddetmenize olanak tanır. Tarayıcı ayarlarınızı değiştirerek çerezleri engelleyebilir veya silebilirsiniz; zorunlu çerezleri engellemek, oturum açmayı veya temel özellikleri çalıştırmanızı engelleyebilir.',
        'Desteklenen bölgelerde Google Analytics kapsamından çıkmak için Google’ın tarayıcı eklentisini veya tarayıcınızın gizlilik denetimlerini de kullanabilirsiniz.',
      ],
    },
    {
      title: '6. Güncellemeler',
      paragraphs: [
        'Bu Çerez Politikasını zaman zaman güncelleyebiliriz. Başlıktaki "Son güncelleme" tarihi en son sürümü yansıtır.',
      ],
    },
  ],
  closing:
    'Çerezler hakkında sorularınız mı var? legal@tscopier.ai adresine yazın veya Gizlilik Politikamıza bakın.',
  contact: legalContactTr,
}
