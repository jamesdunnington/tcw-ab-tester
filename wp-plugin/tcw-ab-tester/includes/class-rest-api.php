<?php
/**
 * REST routes the hub calls INTO WordPress (namespace tcwab/v1). Every
 * route is signature-gated by verify_signature() — see class-hub-client.php
 * verify_request() for the HMAC check itself.
 */

if (!defined('ABSPATH')) {
	exit;
}

class TCWAB_REST_API {

	private TCWAB_Hub_Client $hub_client;
	private TCWAB_Variants $variants;
	private TCWAB_Archive $archive;

	public function __construct(TCWAB_Hub_Client $hub_client, TCWAB_Variants $variants, TCWAB_Archive $archive) {
		$this->hub_client = $hub_client;
		$this->variants    = $variants;
		$this->archive     = $archive;
	}

	public function register_routes(): void {
		add_action('rest_api_init', function () {
			register_rest_route('tcwab/v1', '/posts/(?P<id>\d+)', [
				'methods'             => 'GET',
				'callback'            => [$this, 'get_post_info'],
				'permission_callback' => [$this, 'verify_signature'],
			]);

			register_rest_route('tcwab/v1', '/variants', [
				'methods'             => 'POST',
				'callback'            => [$this, 'create_variant'],
				'permission_callback' => [$this, 'verify_signature'],
			]);

			register_rest_route('tcwab/v1', '/config', [
				'methods'             => 'POST',
				'callback'            => [$this, 'store_config'],
				'permission_callback' => [$this, 'verify_signature'],
			]);
		});
	}

	public function verify_signature(WP_REST_Request $request): bool {
		$site_key  = $request->get_header('x-tcw-site-key');
		$timestamp = $request->get_header('x-tcw-timestamp');
		$nonce     = $request->get_header('x-tcw-nonce');
		$signature = $request->get_header('x-tcw-signature');

		if (!$site_key || !$timestamp || !$nonce || !$signature) {
			return false;
		}
		if (!hash_equals($this->hub_client->get_site_key(), $site_key)) {
			return false;
		}

		// get_route() returns "/tcwab/v1/..." — this must match exactly the
		// path hub/apps/api/src/lib/wp-client.ts signed (it signs the path
		// portion of "/wp-json/tcwab/v1/..."), so rebuild it the same way.
		$path = '/wp-json' . $request->get_route();
		$body = $request->get_body();

		return $this->hub_client->verify_request($request->get_method(), $path, $body, $timestamp, $nonce, $signature);
	}

	public function get_post_info(WP_REST_Request $request) {
		$result = $this->variants->get_post_info((int) $request->get_param('id'));
		if (is_wp_error($result)) {
			return $result;
		}
		return new WP_REST_Response($result, 200);
	}

	public function create_variant(WP_REST_Request $request) {
		$params      = $request->get_json_params();
		$test_id     = sanitize_text_field($params['testId'] ?? '');
		$variant_key = sanitize_text_field($params['variantKey'] ?? '');
		$source_id   = (int) ($params['sourcePostId'] ?? 0);
		$label       = sanitize_text_field($params['label'] ?? 'Variant');

		if (!$test_id || !$variant_key || !$source_id) {
			return new WP_Error('tcwab_bad_request', 'Missing testId, variantKey, or sourcePostId.', ['status' => 400]);
		}

		$result = $this->variants->duplicate_post($source_id, $test_id, $variant_key, $label);
		if (is_wp_error($result)) {
			return $result;
		}

		return new WP_REST_Response($result, 201);
	}

	public function store_config(WP_REST_Request $request) {
		$params = $request->get_json_params();
		$tests  = is_array($params['tests'] ?? null) ? $params['tests'] : [];

		update_option('tcwab_runtime_config', $tests, false);

		return new WP_REST_Response(['ok' => true, 'testCount' => count($tests)], 200);
	}
}
