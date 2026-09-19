<?php
/**
 * Creates the "B" copy of a post/page for a page-test variant, and reads
 * canonical post info back for the hub (so the hub never has to trust a
 * client-supplied post type/permalink — see hub/apps/api/src/lib/wp-client.ts
 * fetchPostInfo).
 *
 * Promotion (copy winner into the original) and cleanup (delete the loser
 * + all its traces) are phase 2 — see docs/PLAN.md section 6 — and are
 * intentionally not implemented here yet.
 */

if (!defined('ABSPATH')) {
	exit;
}

class TCWAB_Variants {

	private const META_VARIANT_OF  = '_tcwab_variant_of';
	private const META_TEST_ID     = '_tcwab_test_id';
	private const META_VARIANT_KEY = '_tcwab_variant_key';

	/** Postmeta keys never carried over onto a duplicate. */
	private const META_BLOCKLIST = [
		'_edit_lock',
		'_edit_last',
		'_wp_old_slug',
		'_wp_old_date',
		'_tcwab_variant_of',
		'_tcwab_test_id',
		'_tcwab_variant_key',
		'_tcwab_variant_label',
	];

	/**
	 * @return array{variantWpPostId:int, previewUrl:string}|WP_Error
	 */
	public function duplicate_post(int $source_id, string $test_id, string $variant_key, string $label) {
		$source = get_post($source_id);
		if (!$source) {
			return new WP_Error('tcwab_source_not_found', 'Source post not found.', ['status' => 404]);
		}

		$new_id = wp_insert_post([
			'post_title'   => $source->post_title, // identical to the original: only the content under test may differ
			'post_content' => $source->post_content,
			'post_excerpt' => $source->post_excerpt,
			'post_type'    => $source->post_type,
			'post_status'  => 'publish', // publicly reachable by URL; hidden from discovery via TCWAB_SEO_Guard
			'post_author'  => $source->post_author,
			'comment_status' => 'closed',
			'ping_status'  => 'closed',
		], true);

		if (is_wp_error($new_id)) {
			return $new_id;
		}

		$this->copy_postmeta($source_id, $new_id);
		$this->copy_taxonomies($source_id, $new_id);

		$thumbnail_id = get_post_thumbnail_id($source_id);
		if ($thumbnail_id) {
			set_post_thumbnail($new_id, $thumbnail_id);
		}

		update_post_meta($new_id, self::META_VARIANT_OF, $source_id);
		update_post_meta($new_id, self::META_TEST_ID, $test_id);
		update_post_meta($new_id, self::META_VARIANT_KEY, $variant_key);
		update_post_meta($new_id, '_tcwab_variant_label', $label);

		return [
			'variantWpPostId' => $new_id,
			'previewUrl'      => get_permalink($new_id),
		];
	}

	public function copy_postmeta(int $source_id, int $target_id): void {
		$all_meta = get_post_meta($source_id);
		foreach ($all_meta as $key => $values) {
			if (in_array($key, self::META_BLOCKLIST, true)) {
				continue;
			}
			foreach ($values as $value) {
				add_post_meta($target_id, $key, maybe_unserialize($value));
			}
		}
	}

	public function copy_taxonomies(int $source_id, int $target_id): void {
		$post_type  = get_post_type($source_id);
		$taxonomies = get_object_taxonomies($post_type);
		foreach ($taxonomies as $taxonomy) {
			$terms = wp_get_object_terms($source_id, $taxonomy, ['fields' => 'ids']);
			if (!is_wp_error($terms) && !empty($terms)) {
				wp_set_object_terms($target_id, $terms, $taxonomy);
			}
		}
	}

	public function is_variant(int $post_id): bool {
		return (bool) get_post_meta($post_id, self::META_VARIANT_OF, true);
	}

	public function get_source_post_id(int $post_id): ?int {
		$source = get_post_meta($post_id, self::META_VARIANT_OF, true);
		return $source ? (int) $source : null;
	}

	/**
	 * Canonical post info the hub trusts over anything a dashboard user typed in.
	 * @return array{id:int,type:string,title:string,permalink:string,wordCount:int}|WP_Error
	 */
	public function get_post_info(int $post_id) {
		$post = get_post($post_id);
		if (!$post || !in_array($post->post_type, ['post', 'page'], true)) {
			return new WP_Error('tcwab_post_not_found', 'Post not found.', ['status' => 404]);
		}

		return [
			'id'        => $post->ID,
			'type'      => $post->post_type,
			'title'     => get_the_title($post),
			'permalink' => get_permalink($post),
			'wordCount' => str_word_count(wp_strip_all_tags($post->post_content)),
		];
	}

	/** Marks variant copies in the wp-admin post list so nobody mistakes one for a normal post. */
	public function add_post_state(array $states, WP_Post $post): array {
		if ($this->is_variant($post->ID)) {
			$label    = (string) get_post_meta($post->ID, '_tcwab_variant_label', true);
			$states[] = $label !== '' ? 'TCW test copy: ' . esc_html($label) : 'TCW test copy';
		}
		return $states;
	}

	/** Postmeta keys on a post that may be copied onto another (everything except internal/test-tracking keys). */
	public function copyable_meta_keys(int $post_id): array {
		return array_values(array_filter(
			array_keys(get_post_meta($post_id)),
			static fn($key) => !in_array($key, self::META_BLOCKLIST, true)
		));
	}
}
