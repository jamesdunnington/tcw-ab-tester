<?php
/**
 * Applies a winning variant to the ORIGINAL post (docs/PLAN.md section 6):
 * the URL, comments and SEO history stay with the original; only its
 * content is replaced. WordPress does not keep the previous content on its
 * own, so promote() saves it as a revision first: "keep old copy" stays one
 * click away in the post's revision history.
 */

if (!defined('ABSPATH')) {
	exit;
}

class TCWAB_Promoter {

	private TCWAB_Variants $variants;

	public function __construct(TCWAB_Variants $variants) {
		$this->variants = $variants;
	}

	/**
	 * @return array{promoted:true, revisionSaved:bool}|WP_Error
	 */
	public function promote(int $source_id, int $winner_id) {
		$source = get_post($source_id);
		$winner = get_post($winner_id);
		if (!$source || !$winner) {
			return new WP_Error('tcwab_post_missing', 'Original or winning post not found.', ['status' => 404]);
		}
		if ($this->variants->get_source_post_id($winner_id) !== $source_id) {
			return new WP_Error('tcwab_wrong_variant', 'The winning post is not a variant of this original.', ['status' => 409]);
		}

		// WordPress does NOT keep the previous content when a post is updated: on a page that was never
		// edited, wp_update_post() only records a revision of the NEW content, and the original would be
		// lost. So save the original's current state as a revision first.
		$saved_revision = wp_save_post_revision($source_id);
		$latest         = array_values(wp_get_post_revisions($source_id));
		// wp_save_post_revision() returns null when an identical revision already exists, which is also fine.
		$original_kept  = (is_int($saved_revision) && $saved_revision > 0)
			|| (!empty($latest) && $latest[0]->post_content === $source->post_content);

		// wp_update_post() unslashes its input, so raw column values must be slashed first or any
		// backslash in the content (escaped characters in block attributes) is silently stripped.
		$updated = wp_update_post(wp_slash([
			'ID'           => $source_id,
			'post_title'   => $winner->post_title,
			'post_content' => $winner->post_content,
			'post_excerpt' => $winner->post_excerpt,
		]), true);
		if (is_wp_error($updated)) {
			return $updated;
		}

		// Replace (not merge) meta so the original ends up an exact copy of the winner,
		// including SEO-plugin fields, page template and featured image.
		foreach ($this->variants->copyable_meta_keys($source_id) as $key) {
			delete_post_meta($source_id, $key);
		}
		$this->variants->copy_postmeta($winner_id, $source_id);
		$this->variants->copy_taxonomies($winner_id, $source_id);

		return [
			'promoted'      => true,
			'revisionSaved' => $original_kept,
		];
	}

	/**
	 * Puts the original's own words back (the hub kept them before the winner replaced them).
	 * The current version is saved as a revision first, so a restore can itself be undone.
	 * Covers title, content and excerpt; template, featured image and SEO fields are not in the snapshot.
	 *
	 * @param array<string, mixed> $snapshot
	 * @return array{restored:true, revisionSaved:bool}|WP_Error
	 */
	public function restore_original(int $post_id, array $snapshot) {
		$post = get_post($post_id);
		if (!$post || !in_array($post->post_type, ['post', 'page'], true)) {
			return new WP_Error('tcwab_post_missing', 'Post not found.', ['status' => 404]);
		}
		if ($this->variants->is_variant($post_id)) {
			return new WP_Error('tcwab_is_variant', 'That post is a test copy, not an original.', ['status' => 409]);
		}
		if (!isset($snapshot['content']) || !is_string($snapshot['content']) || '' === trim($snapshot['content'])) {
			return new WP_Error('tcwab_no_snapshot', 'There is no saved content to restore.', ['status' => 400]);
		}

		$saved_revision = wp_save_post_revision($post_id);
		$latest         = array_values(wp_get_post_revisions($post_id));
		$version_kept   = (is_int($saved_revision) && $saved_revision > 0)
			|| (!empty($latest) && $latest[0]->post_content === $post->post_content);

		$updated = wp_update_post(wp_slash([
			'ID'           => $post_id,
			'post_title'   => sanitize_text_field((string) ($snapshot['title'] ?? $post->post_title)),
			'post_content' => $snapshot['content'],
			'post_excerpt' => sanitize_textarea_field((string) ($snapshot['excerpt'] ?? '')),
		]), true);
		if (is_wp_error($updated)) {
			return $updated;
		}

		// null from wp_save_post_revision() means an identical revision already exists, which also counts.
		return ['restored' => true, 'revisionSaved' => $version_kept];
	}

	/** "Keep the redundant copy" path: hide it instead of deleting it. */
	public function retire(int $variant_post_id): bool {
		if (!$this->variants->is_variant($variant_post_id)) {
			return false;
		}
		$result = wp_update_post(['ID' => $variant_post_id, 'post_status' => 'draft'], true);
		if (is_wp_error($result)) {
			return false;
		}
		update_post_meta($variant_post_id, '_tcwab_retired', 1);
		return true;
	}
}
