<?php
/**
 * Plugin Name: VAP LCP Fix
 * Description: Mejoras LCP, rendimiento y compatibilidad para vapss.net
 * Version: 1.4
 */
defined('ABSPATH') || exit;

// ─────────────────────────────────────────────────────────────
// FIX 1: Quitar defer de jQuery via output buffer
// Jetpack Boost añade defer a jQuery DESPUÉS de script_loader_tag,
// así que usamos ob_start en template_redirect para eliminarlo
// del HTML final antes de enviarlo al navegador.
// Sin esto, sticky.min.js y cf7-conditional-fields fallan con
// "jQuery is not defined".
// ─────────────────────────────────────────────────────────────
add_action('template_redirect', function () {
    ob_start(function ($html) {
        // Quitar defer solo de los scripts de jQuery core y migrate
        $html = preg_replace(
            '/(<script[^>]*(?:jquery\.min\.js|jquery-migrate\.min\.js)[^>]*)\sdefer(=["\']defer["\'])?/i',
            '$1',
            $html
        );
        return $html;
    });
}, 1); // Prioridad 1 — antes que Jetpack Boost (que usa ~10)

// ─────────────────────────────────────────────────────────────
// FIX 2: Preload de la imagen hero (LCP)
// ─────────────────────────────────────────────────────────────
add_action('wp_head', function () {
    if (!is_front_page()) return;
    echo '<link rel="preload" as="image" fetchpriority="high"
        href="https://vapss.net/wp-content/uploads/2024/12/AnyConv.com__portada2-1024x768-1.webp"
        imagesrcset="
            https://vapss.net/wp-content/uploads/2024/12/AnyConv.com__portada2-1024x768-1-300x225.webp 300w,
            https://vapss.net/wp-content/uploads/2024/12/AnyConv.com__portada2-1024x768-1-768x576.webp 768w,
            https://vapss.net/wp-content/uploads/2024/12/AnyConv.com__portada2-1024x768-1.webp 1024w"
        imagesizes="(max-width: 1024px) 100vw, 1024px">' . "\n";
}, 1);

// ─────────────────────────────────────────────────────────────
// FIX 3: Restaurar fetchpriority="high" que Jetpack Boost elimina
// ─────────────────────────────────────────────────────────────
add_action('template_redirect', function () {
    if (!is_front_page()) return;
    ob_start(function ($html) {
        $hero_file = 'AnyConv.com__portada2-1024x768-1.webp';
        return preg_replace_callback(
            '/<img([^>]*' . preg_quote($hero_file, '/') . '[^>]*)>/i',
            function ($matches) {
                $tag = $matches[0];
                $tag = preg_replace('/\s+loading=["\']lazy["\']/i', '', $tag);
                $tag = preg_replace('/\s+data-od-removed-fetchpriority=["\'][^"\']*["\']/i', '', $tag);
                if (strpos($tag, 'fetchpriority') === false) {
                    $tag = str_replace('<img', '<img fetchpriority="high"', $tag);
                }
                return $tag;
            },
            $html
        );
    });
});

// ─────────────────────────────────────────────────────────────
// FIX 4: reCAPTCHA solo en /contacto/
// recaptcha__en.js = 718 KB — no cargar en todas las páginas
// ─────────────────────────────────────────────────────────────
add_action('wp_enqueue_scripts', function () {
    $contact_pages = ['contacto', 'contact', 'contactanos'];
    if (is_page($contact_pages)) return;
    $scripts = ['google-recaptcha', 'wpcf7-recaptcha', 'contact-form-7'];
    $styles  = ['contact-form-7'];
    foreach ($scripts as $h) { wp_dequeue_script($h); wp_deregister_script($h); }
    foreach ($styles  as $h) { wp_dequeue_style($h);  wp_deregister_style($h);  }
}, 99);

// ─────────────────────────────────────────────────────────────
// FIX 5: Preconnect a dominios externos críticos
// ─────────────────────────────────────────────────────────────
add_action('wp_head', function () {
    echo '<link rel="preconnect" href="https://www.googletagmanager.com" crossorigin>' . "\n";
    echo '<link rel="preconnect" href="https://www.google.com" crossorigin>' . "\n";
    echo '<link rel="preconnect" href="https://www.gstatic.com" crossorigin>' . "\n";
    echo '<link rel="dns-prefetch" href="https://www.googletagmanager.com">' . "\n";
    echo '<link rel="dns-prefetch" href="https://www.google.com">' . "\n";
}, 2);

// ─────────────────────────────────────────────────────────────
// FIX 6: GA4 nativo (reemplaza Site Kit)
// ─────────────────────────────────────────────────────────────
add_action('wp_footer', function () {
    ?>
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-LSVSST12QL"></script>
    <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-LSVSST12QL');
    </script>
    <?php
}, 99);
