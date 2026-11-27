import type { RiskDisclaimerPageTranslations } from './types'

export const riskDisclaimerTr: RiskDisclaimerPageTranslations = {
  title: 'Risk uyarısı',
  intro:
    'Yabancı para birimleri, CFD’ler ve diğer kaldıraçlı ürünlerde işlem yapmak ciddi kayıp riski taşır. UniCopier bir işlem kopyalama aracıdır — bir broker, yatırım danışmanı veya finansal planlayıcı değildir. Bu sayfadaki hiçbir şey yatırım tavsiyesi değildir. İşlem kararlarınızdan ve tüm kayıplardan yalnızca siz sorumlusunuz.',
  sections: [
    {
      title: 'Genel işlem riski',
      paragraphs: [
        'Yatırdığınız sermayenin bir kısmını veya tamamını kaybedebilirsiniz. Kaldıraç hem kârı hem kaybı büyütür. Bir sinyal sağlayıcısının, backtest’in veya kendi geçmişinizin geçmiş performansı gelecekteki sonuçları garanti etmez.',
        'Piyasalar haber olayları sırasında boşlukla açılabilir, durabilir veya sert hareket edebilir. UniCopier, sinyallerin belirli bir fiyat veya zamanda alınacağını, ayrıştırılacağını veya yürütüleceğini garanti etmez.',
      ],
    },
    {
      title: 'Sinyal sağlayıcı riski',
      paragraphs: [
        'Yalnızca güvendiğiniz ve anladığınız sinyal sağlayıcılarını kopyalayın. Sağlayıcılar sizin çıkarlarınızla çelişebilecek teşviklere sahip olabilir. Pazarlama ekran görüntüleri, kazanma oranı iddiaları ve seçilmiş sonuçlar; hesabınız, lot büyüklüğünüz, brokerınız veya gecikmenizde yaşayacağınızı yansıtmayabilir.',
        'Mümkün olduğunda performansı bağımsız olarak doğrulayın. Diğerleri için çalışan bir sağlayıcı, risk toleransınıza, hesap büyüklüğünüze veya işlem saatlerinize uygun olmayabilir.',
      ],
    },
    {
      title: 'Yeniden boyama ve kanal aldatmacası',
      paragraphs: [
        'Bazı Telegram sinyal kanalları, bir işlem ters gittiğinde mesajları düzenler veya siler; böylece herkese açık akış kusursuz görünür. “Başarılı” bir çağrı revize edilmiş olabilir; kaybettiren bir çağrı tamamen ortadan kaybolabilir.',
        'Yalnızca kanalın görünür geçmişine veya üçüncü taraf ekran görüntülerine güvenmeyin. Kendi Copier Kayıtlarınız, broker dekontlarınız ve zaman damgalı kayıtlarla karşılaştırın. Yeniden boyama, sağlayıcıların olduğundan daha doğru görünmesini kolaylaştırır.',
      ],
    },
    {
      title: 'Ayrıştırma ve yürütme sınırlamaları',
      paragraphs: [
        'Sinyaller metinden otomatik olarak yorumlanır. Stop loss (SL) veya take profit (TP) yazım hataları — yanlış rakamlar, eksik ondalıklar, belirsiz semboller veya karışık birimler — geçersiz fiyatlar üretebilir. UniCopier sinyali atlayabilir, geçersiz seviyeleri yok sayabilir veya sağlayıcının niyeti yerine yapılandırmanızdaki varsayılanları uygulayabilir.',
        'Yürütme sağlayıcının girişinden farklı olabilir: kayma, yeniden kotasyon, kısmi dolmalar, minimum mesafe kuralları ve broker oturum kesintileri tüm sonuçları etkiler. Sıkı giriş, aralık bekleyen ve çok bacaklı stiller ek karmaşıklık katar. Açık pozisyonlarınızı her zaman brokerınızda gözden geçirin.',
      ],
    },
    {
      title: 'Operasyonel ve yapılandırma riskleri',
      paragraphs: [
        'Haber karantinaları, kanal filtreleri, kâr hedefleri, maksimum kayıp limitleri, abonelik durumu ve kanal bazlı ayarlar kopyalamayı engelleyebilir veya değiştirebilir. Hatalı yapılandırılmış lot büyüklüğü, semböl eşlemeleri veya bağlanmamış kanallar, işlemlerin beklenen şekilde kopyalanmamasının yaygın nedenleridir.',
        'Limitlere ulaşıldığında otomatik kapatma, kanala atfedilen işlemleri UniCopier tarafında kapatır ancak halihazırda oluşan piyasa kaybını geri alamaz. Yapılandırma değişiklikleri kaydedildikten sonra geçerli olur — kaydedilmemiş taslaklar hesabınızı korumaz.',
      ],
    },
    {
      title: 'Kopyalama sırasında aktif kalın',
      paragraphs: [
        'Otomatik kopyalama “kur ve unut” değildir. Açık işlemleri, özkaynağı, teminatı ve Copier Kayıtlarınızı düzenli olarak izleyin. Koşullar değiştiğinde veya bir sağlayıcının pozisyonuna artık katılmadığınızda brokerınızda müdahale edin.',
        'Hesabınızı etkin şekilde gözetemiyorsanız, canlı sinyalleri kopyalamak sizin için uygun olmayabilir.',
      ],
    },
    {
      title: 'Şansınızı artırmak (tavsiye değildir)',
      paragraphs: [
        'Bir Demo hesabıyla veya kaybetmeyi göze alabileceğiniz en küçük canlı boyutla başlayın. Kanalları zamanla değerlendirin; mümkünse backtest’leri kullanın; maksimum kayıp ve kâr hedeflerini etkinleştirin; kanal filtrelerini ayarlayın; riski yoğunlaştırmak yerine sağlayıcılar arasında çeşitlendirin.',
        'Sinyaller işlem olmadığında Copier Kayıtlarındaki atlama nedenlerini okuyun. Gerçekçi beklentileri koruyun — sıkı risk kontrolüyle tutarlı küçük avantajlar, “hızlı zengin ol” pazarlamasından çok farklıdır.',
      ],
    },
  ],
  closing:
    'UniCopier’ı kullanarak, işlemin riskli olduğunu, sinyal sağlayıcılarının güvenilmez veya yanıltıcı olabileceğini ve bağlı hesaplarınızda açılan tüm işlemlerden tam sorumluluğu kabul ettiğinizi beyan edersiniz.',
}
