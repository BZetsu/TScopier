import type { ContactSupportPageTranslations } from './types'

export const contactSupportTr: ContactSupportPageTranslations = {
  channelsTitle: 'Size nasıl yardımcı olabiliriz?',
  channelsSubtitle:
    'UniCopier ekibine e-posta ile ulaşın, dokümanlara göz atın veya uygulama içi destek sohbetini başlatın.',
  systemStatus: {
    title: 'Sistem durumu',
    description: 'UniCopier platform hizmetlerinin şu anda çalışıp çalışmadığını görün.',
    cta: 'Durumu görüntüleyin',
  },
  email: {
    title: 'E-posta desteği',
    description: 'Hesap, faturalama veya Copier sorularınızı bize yazın — genellikle bir iş günü içinde yanıt veririz.',
    cta: 'E-posta gönderin',
  },
  docs: {
    title: 'Dokümantasyon',
    description: 'Broker, Telegram kanalları, işlem stilleri ve sorun giderme için adım adım kılavuzlar.',
    cta: 'Dokümanları açın',
  },
  liveChat: {
    title: 'Destek sohbeti',
    description: 'Dashboard’ta hızlı kurulum yardımı için AI asistanımıza mesaj gönderin veya bir temsilci isteyin.',
    cta: 'Destek sohbetini açın',
  },
  faq: {
    title: 'Sıkça sorulan sorular',
    subtitle: 'Bize ulaşmadan önce hızlı yanıtlar.',
    items: [
      {
        question: 'MetaTrader hesabımı nasıl bağlarım?',
        answer:
          'Yapılandırma bölümünü açın, bir broker hesabı ekleyin, MetaTrader giriş bilgilerinizi girin ve bağlantı durumu Bağlı olarak gösterilene kadar bekleyin. Kopyalama başlamadan önce bağlı her hesap için işlem stili, lot büyüklüğü ve kanal seçiminin kaydedilmiş olması gerekir.',
      },
      {
        question: 'Telegram sinyallerim neden kopyalanmıyor?',
        answer:
          'Brokerınızın bağlı olduğunu, Telegram kanalının bağlı ve etkin olduğunu, Yapılandırmada broker için kanalın seçildiğini, aboneliğinizin etkin olduğunu ve e-postanızın doğrulanmış olduğunu kontrol edin. Kanal filtreleri, haber karantinası veya sinyalde eksik SL/TP gibi atlama nedenleri için Copier Kayıtlarını inceleyin.',
      },
      {
        question: 'Telegram sinyal kanalı nasıl eklenir?',
        answer:
          'Kanallar bölümüne gidin, gerekirse Telegram’ı bağlayın, ardından kanal kullanıcı adını veya davet bağlantısını ekleyin. Kanalı etkinleştirin ve Yapılandırmada sinyallerini kopyalaması gereken broker hesaplarına atayın.',
      },
      {
        question: 'Haber işlemleri / ekonomik takvim karantinası ne işe yarar?',
        answer:
          'Bir hesapta haber işlemleri devre dışı bırakıldığında UniCopier, yüksek etkili takvim olayları civarında yeni girişleri duraklatabilir ve isteğe bağlı olarak açık işlemleri kapatabilir. Yaklaşan verileri görmek için Ekonomik Takvim sayfasını kullanın ve kuralları Hesap Yapılandırması altında yapılandırın.',
      },
      {
        question: 'İşlemleri kopyalamak için ücretli aboneliğe ihtiyacım var mı?',
        answer:
          'Canlı Telegram Copier yürütmesi için etkin bir ücretli plan gerekir. Uygulamayı kullanmak için Fiyatlandırma sayfasında bir plan seçin. Mevcut planınız ve yenileme durumunuz için Faturalama bölümünü kontrol edin.',
      },
      {
        question: 'Platformu kullanmadan önce neden e-postamı doğrulamam gerekiyor?',
        answer:
          'E-posta doğrulaması girişinizi onaylar ve fatura makbuzları ile önemli hesap uyarıları göndermemizi sağlar. Doğrulama ekranında takılırsanız, yeniden gönderme bağlantısını kullanın veya kaydolurken kullandığınız adresle destekle iletişime geçin.',
      },
      {
        question: 'Brokerım bağlı görünmüyor — ne yapmalıyım?',
        answer:
          'MetaTrader’ın broker tarafında çalıştığını, kimlik bilgilerinin hâlâ geçerli olduğunu ve hesabın kilitli olmadığını doğrulayın. Yapılandırmadan yenileyin, ardından oturum hataları için Copier Kayıtlarını kontrol edin. Sorun devam ederse, broker adınız ve hesap giriş bilginizle (asla şifrenizle) e-posta ile destekle iletişime geçin.',
      },
      {
        question: 'Aynı kanalı birden fazla broker için kopyalayabilir miyim?',
        answer:
          'Evet. Yapılandırmada her MetaTrader hesabını ayrı ayrı bağlayın ve her brokerda aynı Telegram kanalını seçin. Lot büyüklüğü, işlem stili ve risk ayarları hesap bazındadır.',
      },
    ],
  },
}
