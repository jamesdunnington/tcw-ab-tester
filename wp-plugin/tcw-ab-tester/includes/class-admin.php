<?php
/**
 * The plugin's one settings screen: connect to the hub (URL, site key,
 * site secret — pasted in from the hub's "New Site" screen, see
 * hub/apps/api/src/routes/sites.ts), a Test Connection button, and a
 * read-only list of this site's test archive (class-archive.php).
 */

if (!defined('ABSPATH')) {
	exit;
}

class TCWAB_Admin {

	private const NONCE_ACTION = 'tcwab_save_settings';

	private TCWAB_Hub_Client $hub_client;
	private TCWAB_Archive $archive;

	public function __construct(TCWAB_Hub_Client $hub_client, TCWAB_Archive $archive) {
		$this->hub_client = $hub_client;
		$this->archive    = $archive;
	}

	public function register_menu(): void {
		add_options_page(
			__('TCW A/B Tester', 'tcw-ab-tester'),
			__('TCW A/B Tester', 'tcw-ab-tester'),
			'manage_options',
			'tcwab-settings',
			[$this, 'render_settings_page']
		);
	}

	/** Handles the settings form POST. Named register_settings() to match the admin_init hook site — see tcw-ab-tester.php. */
	public function register_settings(): void {
		if (!isset($_POST['tcwab_save_settings']) || !current_user_can('manage_options')) {
			return;
		}
		check_admin_referer(self::NONCE_ACTION);

		$hub_url    = isset($_POST['tcwab_hub_url']) ? sanitize_text_field(wp_unslash($_POST['tcwab_hub_url'])) : '';
		$site_key   = isset($_POST['tcwab_site_key']) ? sanitize_text_field(wp_unslash($_POST['tcwab_site_key'])) : '';
		$site_secret = isset($_POST['tcwab_site_secret']) ? sanitize_text_field(wp_unslash($_POST['tcwab_site_secret'])) : '';

		$this->hub_client->save_settings($hub_url, $site_key, $site_secret);
		update_option('tcwab_strict_consent', isset($_POST['tcwab_strict_consent']) ? 1 : 0, false);
		update_option('tcwab_include_staff', isset($_POST['tcwab_include_staff']) ? 1 : 0, false);

		add_action('admin_notices', function () {
			echo '<div class="notice notice-success is-dismissible"><p>' .
				esc_html__('TCW A/B Tester settings saved.', 'tcw-ab-tester') .
				'</p></div>';
		});
	}

	public function render_settings_page(): void {
		if (!current_user_can('manage_options')) {
			return;
		}

		wp_enqueue_script('tcwab-admin', TCWAB_PLUGIN_URL . 'admin/js/admin.js', ['jquery'], TCWAB_VERSION, true);
		wp_enqueue_style('tcwab-admin', TCWAB_PLUGIN_URL . 'admin/css/admin.css', [], TCWAB_VERSION);
		wp_localize_script('tcwab-admin', 'TCWAB_ADMIN', [
			'ajaxUrl' => admin_url('admin-ajax.php'),
			'nonce'   => wp_create_nonce('tcwab_test_connection'),
		]);

		$hub_url  = $this->hub_client->get_hub_url();
		$site_key = $this->hub_client->get_site_key();
		$entries  = $this->archive->all_entries();
		?>
		<div class="wrap tcwab-settings">
			<h1><?php esc_html_e('TCW A/B Tester', 'tcw-ab-tester'); ?></h1>

			<form method="post">
				<?php wp_nonce_field(self::NONCE_ACTION); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="tcwab_hub_url"><?php esc_html_e('Hub URL', 'tcw-ab-tester'); ?></label></th>
						<td><input type="url" id="tcwab_hub_url" name="tcwab_hub_url" class="regular-text"
							value="<?php echo esc_attr($hub_url); ?>" placeholder="https://ab.yourdomain.com" /></td>
					</tr>
					<tr>
						<th scope="row"><label for="tcwab_site_key"><?php esc_html_e('Site Key', 'tcw-ab-tester'); ?></label></th>
						<td><input type="text" id="tcwab_site_key" name="tcwab_site_key" class="regular-text"
							value="<?php echo esc_attr($site_key); ?>" /></td>
					</tr>
					<tr>
						<th scope="row"><label for="tcwab_site_secret"><?php esc_html_e('Site Secret', 'tcw-ab-tester'); ?></label></th>
						<td>
							<input type="password" id="tcwab_site_secret" name="tcwab_site_secret" class="regular-text"
								placeholder="<?php echo $this->hub_client->is_configured() ? esc_attr__('•••••••• (unchanged)', 'tcw-ab-tester') : ''; ?>" />
							<p class="description"><?php esc_html_e('Shown once when the site is created on the hub. Leave blank to keep the current secret.', 'tcw-ab-tester'); ?></p>
						</td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e('Your own visits', 'tcw-ab-tester'); ?></th>
						<td>
							<label for="tcwab_include_staff">
								<input type="checkbox" id="tcwab_include_staff" name="tcwab_include_staff" value="1" <?php checked((bool) get_option('tcwab_include_staff', false)); ?> />
								<?php esc_html_e('Include logged-in editors and admins in tests', 'tcw-ab-tester'); ?>
							</label>
							<p class="description">
								<?php esc_html_e('Off by default: while you are logged in as an editor or admin you always see the original page and your visits are not counted. Turn this on only to try a live test yourself.', 'tcw-ab-tester'); ?>
							</p>
						</td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e('Consent', 'tcw-ab-tester'); ?></th>
						<td>
							<label for="tcwab_strict_consent">
								<input type="checkbox" id="tcwab_strict_consent" name="tcwab_strict_consent" value="1" <?php checked((bool) get_option('tcwab_strict_consent', false)); ?> />
								<?php esc_html_e('Strict mode: show everyone the original page until they accept statistics cookies', 'tcw-ab-tester'); ?>
							</label>
							<p class="description">
								<?php esc_html_e('Statistics consent is read live in each visitor browser from the WP Consent API, Complianz or CookieYes. Without a consent tool nothing is tracked. In the default mode visitors are still split between versions with a functional cookie, but no engagement events are recorded until they consent.', 'tcw-ab-tester'); ?>
							</p>
						</td>
					</tr>
				</table>
				<p class="submit">
					<button type="submit" name="tcwab_save_settings" value="1" class="button button-primary">
						<?php esc_html_e('Save Settings', 'tcw-ab-tester'); ?>
					</button>
					<button type="button" id="tcwab-test-connection" class="button">
						<?php esc_html_e('Test Connection', 'tcw-ab-tester'); ?>
					</button>
					<span id="tcwab-test-connection-result"></span>
				</p>
			</form>

			<h2><?php esc_html_e('Test Archive', 'tcw-ab-tester'); ?></h2>
			<?php if (empty($entries)) : ?>
				<p><?php esc_html_e('No tests have run on this site yet. Full history and live results live on the hub.', 'tcw-ab-tester'); ?></p>
			<?php else : ?>
				<table class="widefat striped">
					<thead>
						<tr>
							<th><?php esc_html_e('Test', 'tcw-ab-tester'); ?></th>
							<th><?php esc_html_e('Post', 'tcw-ab-tester'); ?></th>
							<th><?php esc_html_e('Winner', 'tcw-ab-tester'); ?></th>
							<th><?php esc_html_e('Redundant copy deleted?', 'tcw-ab-tester'); ?></th>
							<th><?php esc_html_e('Decided', 'tcw-ab-tester'); ?></th>
						</tr>
					</thead>
					<tbody>
					<?php foreach ($entries as $row) : ?>
						<tr>
							<td><?php echo esc_html($row['test_name']); ?></td>
							<td><a href="<?php echo esc_url(get_edit_post_link((int) $row['wp_post_id'])); ?>">#<?php echo (int) $row['wp_post_id']; ?></a></td>
							<td><?php echo esc_html($row['winner_key'] ?: '—'); ?></td>
							<td><?php echo $row['redundant_deleted'] ? esc_html__('Yes', 'tcw-ab-tester') : esc_html__('No', 'tcw-ab-tester'); ?></td>
							<td><?php echo esc_html($row['decided_at'] ?: '—'); ?></td>
						</tr>
					<?php endforeach; ?>
					</tbody>
				</table>
			<?php endif; ?>
		</div>
		<?php
	}

	public function ajax_test_connection(): void {
		check_ajax_referer('tcwab_test_connection', 'nonce');
		if (!current_user_can('manage_options')) {
			wp_send_json_error(['message' => __('Insufficient permissions.', 'tcw-ab-tester')], 403);
		}

		$result = $this->hub_client->test_connection();
		if (is_wp_error($result)) {
			wp_send_json_error(['message' => $result->get_error_message()], 502);
		}

		wp_send_json_success($result);
	}
}
