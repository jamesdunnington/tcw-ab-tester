<?php
/**
 * Plugin Name: TCW A/B Tester
 * Plugin URI: https://github.com/
 * Description: Engagement-based A/B testing for pages, posts, and elements. All data, statistics, and the visual editor live on your self-hosted TCW hub; this plugin is a thin, signed bridge between WordPress and it.
 * Version: 0.1.0
 * Requires at least: 6.0
 * Requires PHP: 8.0
 * Author: TCW
 * License: GPL v2 or later
 * Text Domain: tcw-ab-tester
 *
 * Phase 1 scope (see docs/PLAN.md in the repo root): page/post split
 * tests end to end. Visual element editing, heatmaps, and the winner
 * promote/cleanup flow ship in later phases.
 */

if (!defined('ABSPATH')) {
	exit; // No direct access.
}

define('TCWAB_VERSION', '0.1.0');
define('TCWAB_PLUGIN_FILE', __FILE__);
define('TCWAB_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('TCWAB_PLUGIN_URL', plugin_dir_url(__FILE__));

require_once TCWAB_PLUGIN_DIR . 'includes/class-hub-client.php';
require_once TCWAB_PLUGIN_DIR . 'includes/class-rest-api.php';
require_once TCWAB_PLUGIN_DIR . 'includes/class-editor-bridge.php';
require_once TCWAB_PLUGIN_DIR . 'includes/class-runtime.php';
require_once TCWAB_PLUGIN_DIR . 'includes/class-variants.php';
require_once TCWAB_PLUGIN_DIR . 'includes/class-seo-guard.php';
require_once TCWAB_PLUGIN_DIR . 'includes/class-archive.php';
require_once TCWAB_PLUGIN_DIR . 'includes/class-cache-purge.php';
require_once TCWAB_PLUGIN_DIR . 'includes/class-cleanup.php';
require_once TCWAB_PLUGIN_DIR . 'includes/class-promoter.php';
require_once TCWAB_PLUGIN_DIR . 'includes/class-finalizer.php';
require_once TCWAB_PLUGIN_DIR . 'includes/class-admin.php';

/**
 * Central plugin instance. Deliberately not a singleton-with-global-state
 * everywhere — each class owns one responsibility and is wired here.
 */
final class TCWAB_Plugin {

	private static ?TCWAB_Plugin $instance = null;

	public TCWAB_Hub_Client $hub_client;
	public TCWAB_REST_API $rest_api;
	public TCWAB_Runtime $runtime;
	public TCWAB_Editor_Bridge $editor_bridge;
	public TCWAB_Variants $variants;
	public TCWAB_SEO_Guard $seo_guard;
	public TCWAB_Archive $archive;
	public TCWAB_Admin $admin;

	public static function instance(): TCWAB_Plugin {
		if (null === self::$instance) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	private function __construct() {
		$this->archive    = new TCWAB_Archive();
		$this->hub_client = new TCWAB_Hub_Client();
		$this->variants   = new TCWAB_Variants();
		$this->seo_guard  = new TCWAB_SEO_Guard();
		$cache            = new TCWAB_Cache_Purge();
		$finalizer        = new TCWAB_Finalizer(new TCWAB_Promoter($this->variants), new TCWAB_Cleanup($this->variants), $cache, $this->archive);
		$this->rest_api   = new TCWAB_REST_API($this->hub_client, $this->variants, $finalizer, $cache);
		$this->runtime    = new TCWAB_Runtime($this->hub_client);
		$this->editor_bridge = new TCWAB_Editor_Bridge($this->hub_client);
		$this->admin      = new TCWAB_Admin($this->hub_client, $this->archive);

		add_action('init', [$this->rest_api, 'register_routes']);
		add_action('wp_head', [$this->runtime, 'print_head_snippet'], 1);
		add_action('template_redirect', [$this->editor_bridge, 'gate'], 1);
		add_action('wp', [$this->seo_guard, 'maybe_noindex_variant']);
		add_filter('pre_get_posts', [$this->seo_guard, 'exclude_variants_from_queries']);
		add_filter('get_pages', [$this->seo_guard, 'exclude_variants_from_page_lists']);
		add_filter('wp_sitemaps_posts_query_args', [$this->seo_guard, 'exclude_variants_from_sitemaps']);
		add_filter('display_post_states', [$this->variants, 'add_post_state'], 10, 2);
		add_action('admin_menu', [$this->admin, 'register_menu']);
		add_action('admin_init', [$this->admin, 'register_settings']);
		add_action('wp_ajax_tcwab_test_connection', [$this->admin, 'ajax_test_connection']);
	}
}

register_activation_hook(__FILE__, ['TCWAB_Archive', 'install_table']);

/** Convenience accessor used across includes/*.php instead of passing the instance everywhere. */
function tcwab(): TCWAB_Plugin {
	return TCWAB_Plugin::instance();
}

tcwab();
