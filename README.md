# Neon Drift

Gece vakti fütüristik bir pistte zamana karşı yarışılan, tarayıcıda çalışan 3D arcade yarış oyunu.
Vite + TypeScript + Three.js. Garajda on gerçek araç (Golf 6 GTI, Golf 6 5 kapı, Skyline R34, AE86,
911 Turbo, M3 E30, Tofaş Şahin, Fiat Doblo, Fiat Egea, Corolla E100); modeller Sketchfab'dan CC lisansıyla. Model dosyası yoksa oyun kodla üretilmiş
Golf 6 ile çalışır; ses ve diğer tüm görseller kodla üretilir.

## Çalıştırma

```bash
npm install
npm run dev        # http://localhost:5195
npm run build      # tip denetimi + dist/ üretim derlemesi
npm run preview    # derlemeyi http://localhost:5196 üzerinde sunar
```

## Pistler

Menüde **Pist** satırından seçilir (◀ ▶ / D-pad / tıklama):

- **Neon Pist:** 1.16 km teknik tur pisti (firkete, şikan, iki düzlük); 1, 3 veya 5 tur.
- **Gece Otoyolu:** 4 km dümdüz sprint. 2 şerit gidiş, 2 şerit geliş; ortada boyalı çift çizgi
  (fiziksel engel yok, karşı şeritten sollamak mümkün ama riskli). Trafikte garajdaki gerçek
  araçlar dolaşır: öndekini izler, tıkanınca şerit değiştirir, önlerine çıkarsan fren yapar.
  Çarpışmalar iki aracı da savurur; HUD'da kilometre, hedef süre ve çarpma sayısı, sonuçta
  kilometre ara süreleri gösterilir.

Rekorlar ve hayalet her pist + araç için ayrı tutulur.

## Gerçek araç modellerini ekleme

Sketchfab indirmeleri giriş gerektirir. Her model için **Download 3D Model → glTF** (veya GLB)
indirip `~/Downloads`'a kaydedin, sonra tek komutla hepsini içe aktarın:

```bash
npm run import-car -- --scan
```

Tek dosya için: `npm run import-car -- <kimlik> <zip|glb>` (kimlikler aşağıdaki tabloda).

Kimlik | Araç | Model | Yazar | Lisans
--- | --- | --- | --- | ---
golf6 | Golf 6 GTI (ana araç) | [Volkswagen Golf 6. (A6)](https://sketchfab.com/3d-models/volkswagen-golf-6-a6-8d8a301cee5143e9a6f25519e32dde21) | GT Cars: Hyperspeed (Car2022) | CC BY
golf6b | Golf 6 (5 kapı) | [Volkswagen Golf 6](https://sketchfab.com/3d-models/volkswagen-golf-6-46d9c43124b94f6293920944bef5b563) | Nieve5677 | CC BY
r34 | Skyline R34 | [Nissan Skyline R34 GT-R](https://sketchfab.com/3d-models/ff8fb2251dfa4bb9979e7022c5a6666c) | Lexyc16 | CC BY
ae86 | AE86 Trueno | [Toyota Corolla AE86 Trueno](https://sketchfab.com/3d-models/fe02fba6302e450ea8424591493341ea) | Lexyc16 | CC BY
p930 | 911 Turbo | [Porsche 911 (930) Turbo 1975](https://sketchfab.com/3d-models/de1ffd344c41481892511f7fd332c136) | Lexyc16 | CC BY
e30 | M3 E30 | [[FREE] BMW M3 E30](https://sketchfab.com/3d-models/ac3c7013434e403e8faff87948caf422) | TinoD2 | CC BY
sahin | Tofaş Şahin | [Sahin 1993 model retro Turkey model](https://sketchfab.com/3d-models/ea8ec14f315f4247afceadb5b359a757) | oguzvideostudio | CC BY-NC-SA (yalnızca ticari olmayan kullanım)
doblo | Fiat Doblo | [Fiat Doblo 2005 MK1](https://sketchfab.com/3d-models/4a20dd92f0bd4e89b350eec83398b4be) | szymonpasterczyk | CC BY
egea | Fiat Egea | [Fiat Egea](https://sketchfab.com/3d-models/8b0bf29d19a24ceeb60c5312090d5477) | superscriptdev2 | CC BY
corolla93 | Corolla E100 | [Toyota Corolla MK7 (E100) 1992-1997](https://sketchfab.com/3d-models/c5ca8d403fbe40a1a438e1cb59d0469c) | szymonpasterczyk | CC BY

Modeller farklı biçimlerde gelir; `src/vehicle/cars.ts` içindeki `model` ayarlarıyla düzeltilir:
`rotationX`/`rotationY` (eksen ve yön), `hide` (kopuk, içte kalan ya da üst üste binen donanım
seçenekleri; `=` ile tam düğüm adı), `groundCut`
(taramalardaki zemin dilimi), `addWheels` (tekerleksiz modellere kodla tekerlek; `fromNodes` ile aks
yeri süspansiyon göbeklerinden okunur), `paintMaterials` / `tailMaterials` / `headMaterials` ve
`factoryColor` (dokusuz modellerin rengi), `parts` (düğüm ya da malzeme adına göre rol: boya,
cam, lastik, jant, plastik, iç, krom, far, stop — tek malzemeli modelleri gerçek malzemelerle
giydirir), `glossy` (fotoğraf dokulu taramalara vernik + hafif ışıma), `plate` (görünmez plaka
parçasının yerine oyunun plakası) ve `exhaust` (egzoz ucu parçası: turbo alevi ve gaz kesilince geri
tepme patlamaları buradan çıkar). Araç boyasına yalnız boyayı etkileyen nötr bir dolgu ışığı eklenir:
sahnenin mor ışığı beyazı lila, kırmızıyı pembe gösteriyordu. Dokusuz çok malzemeli
modellerde roller malzeme adından da otomatik çıkar (glass/vidrio, tire/goma, chrome, cuero…). Yükleyici ayrıca ana gövdeden kopuk parçaları otomatik
gizler ve far/stop konumundan ön yönü kendisi bulur.

Oyunda (Garaj ve Kontroller ekranı) yazar, bağlantı ve lisans gösterilir. Tofaş Şahin modeli
ticari olmayan lisanslıdır: oyun satılacaksa bu model çıkarılmalı. Betik dokuları 1024 px WebP'ye
küçültür, 150 bin üçgenden ağır modelleri sadeleştirir, geometriyi meshopt ile sıkıştırır,
`public/models/<id>.glb` yazar ve `manifest.json`'u günceller. Oyun yalnızca manifestteki
dosyaları ister; modeli olmayan araç garajda kilitli görünür.

## Grafik

Ayarlar → Grafik kalitesi: Otomatik / Düşük / Orta / Yüksek / Ultra.

- Islak asfalt: düz pist için düzlemsel yansıma; su birikintilerinde daha parlak (Orta ve üstü).
- Bloom, vinyet, hafif renk sapması ve film greni; farların hacimsel ışık konisi (Yüksek ve üstü).
- Ultra: neredeyse tam çözünürlükte yansıma ve 4K gölge haritası.
- Otomatik mod kare hızı düşerse kaliteyi kendiliğinden bir kademe azaltır.

## Kontroller

| Eylem | Klavye | Gamepad (standart düzen) |
| --- | --- | --- |
| Yön | A D / ← → | Sol analog çubuk (D-pad de olur) |
| Gaz | W / ↑ | RT (sağ tetik) |
| Fren / geri | S / ↓ | LT (sol tetik) |
| Drift / el freni | Space | A / ✕ |
| Piste geri dön | R | Y / △ |
| Duraklat | Esc / P | Start / Options |
| Menü | ↑ ↓ ← →, Enter, Esc | D-pad / çubuk, A onay, B geri |

Drift: virajda direksiyonu kırıp drift tuşunu basılı tut. Şarj mavi, sonra pembe seviyeye dolar;
bırakınca seviyeye göre turbo verir.

### Logitech F710 (macOS)

- Kumandanın arkasındaki **X/D anahtarını D konumuna alın.** macOS, X (XInput) modunu sürücüsüz
  tanımaz; bu modda hiçbir tarayıcı kumandayı göremez (sistemde `046d:c21f` olarak görünür).
- **Mode** ışığı kapalı olmalı (açıkken sol çubuk ile D-pad yer değiştirir).
- Sayfa açıkken kumandada bir tuşa basın; tarayıcılar ancak o zaman kumandayı gösterir.
- D modunda tetikler analog değil, açık/kapalı çalışır. Tarayıcı standart eşleme vermezse oyun
  Logitech D düzenini kendisi çevirir (A/X sırası, şapka ekseninden D-pad).
- **Ayarlar → Kontroller** ekranındaki "Kumanda testi" paneli, tarayıcının gördüğü kumandayı ve
  basılan tuşları canlı gösterir.

## Yapı

```
src/
  core/Game.ts            durum makinesi (menü, geri sayım, yarış, bitiş, sonuç, duraklatma) ve döngü
  input/                  GamepadManager (Gamepad API), KeyboardManager, InputManager (birleşik eylemler)
  vehicle/                CarPhysics (delta time, 120 Hz alt adım, araç başına parametreler),
                          cars.ts (araç kataloğu), GltfCarModel (GLB araç), CarModel (prosedürel Golf 6),
                          carAssets (manifest + GLTFLoader), Autopilot
  world/                  tracks.ts (pist tanımları), Track (kapalı tur / açık düz yol, sorgular),
                          TrackMesh, Environment, dokular, ortam haritası
  fx/                     lastik izi, parçacıklar, hız çizgileri, bloom/vinyet (PostFX),
                          PlanarReflection (ıslak yol), HeadlightBeams
  race/                   tur/sprint takibi, madalyalar, hayalet araç, Traffic (otoyol trafiği),
                          TrafficFactory (araçları malzeme başına tek mesh'e pişirir)
  audio/                  Web Audio ile sentezlenen efektler ve müzik
  ui/                     HUD, menüler, gezinme, mini harita
  settings/Settings.ts    localStorage'da ayarlar ve rekorlar (pist değişince rekorlar sıfırlanır)
scripts/                  başsız denetimler: pist geometrisi, tur simülasyonu, drift testi
```

Başsız denetimler:

```bash
npx vite-node scripts/analyze-track.ts   # viraj yarıçapları, pistin kendine yaklaşma mesafesi
npx vite-node scripts/sim-laps.ts 1.3 r34  # otopilotla 3 tur (araç seçilebilir)
npx vite-node scripts/sim-drift.ts       # drift yarıçapı, kayma açısı, turbo seviyesi
```
