<?php
/**
 * Removes every trace of a redundant variant copy (docs/PLAN.md section 6).
 *
 * wp_delete_post($id, true) already removes the post row, its revisions,
 * postmeta, comments and term relationships. This class adds what core does
 * not: nav-menu entries pointing at the copy, and an attachment that was
 * uploaded only for it. SEO-plugin index tables (Yoast/RankMath) are not
 * touched directly: they rebuild from the postmeta that is now gone.
 *
 * SAFETY: refuses to delete any post that is not a TCW variant copy.
 */

if (!defined('ABSPATH')) {
	exit;
}

class TCWAB_Cleanup {

	private TCWAB_Variants $variants;

	public function __construct(TCWAB_Variants $variants) {
		$this->variants = $variants;
	}

	/**
	 * @return array{deletedPostId:int, deletedMenuItems:int[], deletedAttachments:int[]}|WP_Error
	 */
	public function delete_variant(int $variant_post_id) {
		if (!$this->variants->is_variant($variant_post_id)) {
			return new WP_Error('tcwab_not_a_variant', 'Refusing to delete a post that is not a TCW variant copy.', ['status' => 409]);
		}

		$menu_items  = $this->find_menu_items($variant_post_id);
		$attachments = $this->attachments_owned_only_by($variant_post_id);

		$deleted_menu_items = [];
		foreach ($menu_items as $item_id) {
			if (wp_delete_post($item_id, true)) {
				$deleted_menu_items[] = $item_id;
			}
		}

		if (!wp_delete_post($variant_post_id, true)) {
			return new WP_Error('tcwab_delete_failed', 'WordPress refused to delete the variant post.', ['status' => 500]);
		}

		$deleted_attachments = [];
		foreach ($attachments as $attachment_id) {
			if (wp_delete_attachment($attachment_id, true)) {
				$deleted_attachments[] = $attachment_id;
			}
		}

		return [
			'deletedPostId'      => $variant_post_id,
			'deletedMenuItems'   => $deleted_menu_items,
			'deletedAttachments' => $deleted_attachments,
		];
	}

	/** @return int[] */
	private function find_menu_items(int $post_id): array {
		$items = get_posts([
			'post_type'      => 'nav_menu_item',
			'post_status'    => 'any',
			'numberposts'    => -1,
			'fields'         => 'ids',
			'meta_key'       => '_menu_item_object_id', // phpcs:ignore WordPress.DB.SlowDBQuery
			'meta_value'     => $post_id, // phpcs:ignore WordPress.DB.SlowDBQuery
		]);
		return array_map('intval', $items);
	}

	/**
	 * Attachments uploaded to this variant (post_parent) that no OTHER post
	 * uses as its featured image. A duplicate reuses the original's images,
	 * so this is normally empty — deliberately conservative.
	 *
	 * @return int[]
	 */
	private function attachments_owned_only_by(int $post_id): array {
		$children = get_children([
			'post_parent' => $post_id,
			'post_type'   => 'attachment',
			'fields'      => 'ids',
		]);

		$owned = [];
		foreach ($children as $attachment_id) {
			$used_elsewhere = get_posts([
				'post_type'      => 'any',
				'post_status'    => 'any',
				'numberposts'    => 1,
				'fields'         => 'ids',
				'post__not_in'   => [$post_id],
				'meta_key'       => '_thumbnail_id', // phpcs:ignore WordPress.DB.SlowDBQuery
				'meta_value'     => $attachment_id, // phpcs:ignore WordPress.DB.SlowDBQuery
			]);
			if (empty($used_elsewhere)) {
				$owned[] = (int) $attachment_id;
			}
		}
		return $owned;
	}
}
