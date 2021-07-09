/**
 * @license Copyright (c) 2003-2021, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.md or https://ckeditor.com/legal/ckeditor-oss-license
 */

/**
 * @module drupal-image/drupalimage
 */

/*
<imageBlock>
	<caption>xxx</caption>
</imageBlock>

----

Step 1. Make editor.getData() return this:

<drupal-img src data-align ...>
	<figcaption>foo <strong>bar</strong></figcaption>
</drupal-img>

Step 2. Override editor.data.stringify in a way that it takes figcaption from drupal-img and moves it to the attribute of drupal-img, removes figcaption and replaces drupal-img with img
*/

import { Plugin } from 'ckeditor5/src/core';

export default class DrupalImageEditing extends Plugin {
	/**
	 * @inheritDoc
	 */
	static get pluginName() {
		return 'DrupalImageEditing';
	}

	/**
	 * @inheritDoc
	 */
	init() {
		const editor = this.editor;
		const conversion = editor.conversion;
		const { schema } = editor.model;

		if ( schema.isRegistered( 'imageInline' ) ) {
			schema.extend( 'imageInline', {
				allowAttributes: [
					'dataEntityUuid',
					'dataEntityFile'
				]
			} );
		}

		if ( schema.isRegistered( 'imageBlock' ) ) {
			schema.extend( 'imageBlock', {
				allowAttributes: [
					'dataEntityUuid',
					'dataEntityFile'
				]
			} );
		}

		// Conversion.
		conversion.for( 'upcast' )
			.add( viewImageToModelImage( editor ) );
		conversion.for( 'downcast' )
			// TODO: Alignment downcast to data-align
			// TODO: Missing space before the inline image (check upcast first)
			// TODO: setData/getData automated integration tests
			.add( modelEntityUuidToDataAttribute() )
			.add( modelEntityFileToDataAttribute() );

		conversion.for( 'dataDowncast' )
			// .add( dispatcher => {
			// 	dispatcher.on( 'insert:caption', ( evt, data, conversionApi ) => {

			// 		if ( !conversionApi.consumable.consume( data.item, 'insert' ) ) {
			// 			return;
			// 		}

			// 		console.log( editor.data.stringify( data.item ) );

			// 		// if ( captionText ) {
			// 		// 	const imageViewElement = conversionApi.mapper.toViewElement( data.item.parent );

			// 		// 	conversionApi.writer.setAttribute( 'data-caption', captionText, imageViewElement );
			// 		// }
			// 	},
			// 	{ priority: 'high' }
			// 	);
			// } )
			// .add( dispatcher => {
			// 	dispatcher.on( 'insert:$text', ( evt, data ) => {
			// 		const { parent } = data.item;
			// 		const isInImageCaption = parent.is( 'element', 'caption' ) && parent.parent.is( 'element', 'imageBlock' );

			// 		if ( isInImageCaption ) {
			// 			// Prevent `modelViewSplitOnInsert()` function inside ckeditor5-list package from interfering when downcasting
			// 			// a text inside caption. Normally aforementioned function tries to mitigate side effects of inserting content in
			// 			// the middle of the lists, but in this case we want to stop the conversion from proceeding.
			// 			evt.stop();
			// 		}
			// 	},
			// 	// Make sure we are overriding the `modelViewSplitOnInsert() converter from ckeditor5-list.
			// 	{ priority: 'highest' }
			// 	);
			// } )
			.elementToElement( {
				model: 'imageBlock',
				view: ( modelElement, { writer, consumable } ) => createImageViewElement( writer, modelElement, editor, consumable ),
				converterPriority: 'high'
			} )
			.elementToElement( {
				model: 'imageInline',
				view: ( modelElement, { writer } ) => createImageViewElement( writer, modelElement ),
				converterPriority: 'high'
			} );
	}
}

function viewImageToModelImage( editor ) {
	return dispatcher => {
		dispatcher.on( 'element:img', converter, { priority: 'high' } );
	};

	function converter( evt, data, conversionApi ) {
		const { viewItem } = data;
		const { writer, consumable, safeInsert, updateConversionResult, schema } = conversionApi;
		const attributesToConsume = [];

		let image;

		// Not only check if a given `img` view element has been consumed, but also verify it has `src` attribute present.
		if ( !consumable.test( viewItem, { name: true, attributes: 'src' } ) ) {
			return;
		}

		// Create image that's allowed in the given context.
		if ( schema.checkChild( data.modelCursor, 'imageInline' ) ) {
			image = writer.createElement( 'imageInline', { src: viewItem.getAttribute( 'src' ) } );
		} else {
			image = writer.createElement( 'imageBlock', { src: viewItem.getAttribute( 'src' ) } );
		}

		if ( editor.plugins.has( 'ImageStyleEditing' ) &&
			consumable.test( viewItem, { name: true, attributes: 'data-align' } )
		) {
			// https://ckeditor.com/docs/ckeditor5/latest/api/module_image_imagestyle_utils.html#constant-defaultStyles
			const dataToPresentationMapBlock = {
				left: 'alignBlockLeft',
				center: 'alignCenter',
				right: 'alignBlockRight'
			};
			const dataToPresentationMapInline = {
				left: 'alignLeft',
				right: 'alignRight'
			};

			const dataAlign = viewItem.getAttribute( 'data-align' );
			const alignment = image.is( 'element', 'imageBlock' ) ?
				dataToPresentationMapBlock[ dataAlign ] :
				dataToPresentationMapInline[ dataAlign ];

			writer.setAttribute( 'imageStyle', alignment, image );

			// Make sure the attribute can be consumed after successful `safeInsert` operation.
			attributesToConsume.push( 'data-align' );
		}

		// Check if the view element has still unconsumed `data-caption` attribute.
		// Also, we can add caption only to block image.
		if ( image.is( 'element', 'imageBlock' ) &&
			consumable.test( viewItem, { name: true, attributes: 'data-caption' } )
		) {
			// Create `caption` model element. Thanks to that element the rest of the `ckeditor5-plugin` converters can
			// recognize this image as a block image with a caption.
			const caption = writer.createElement( 'caption' );

			writer.insertText( viewItem.getAttribute( 'data-caption' ), caption );

			// Insert the caption element into image, as a last child.
			writer.append( caption, image );

			// Make sure the attribute can be consumed after successful `safeInsert` operation.
			attributesToConsume.push( 'data-caption' );
		}

		if ( consumable.test( viewItem, { name: true, attributes: 'data-entity-uuid' } ) ) {
			writer.setAttribute( 'dataEntityUuid', viewItem.getAttribute( 'data-entity-uuid' ), image );
			attributesToConsume.push( 'data-entity-uuid' );
		}

		if ( consumable.test( viewItem, { name: true, attributes: 'data-entity-file' } ) ) {
			writer.setAttribute( 'dataEntityFile', viewItem.getAttribute( 'data-entity-file' ), image );
			attributesToConsume.push( 'data-entity-file' );
		}

		// Try to place the image in the allowed position.
		if ( !safeInsert( image, data.modelCursor ) ) {
			return;
		}

		// Mark given element as consumed. Now other converters will not process it anymore.
		consumable.consume( viewItem, { name: true, attributes: attributesToConsume } );

		// Make sure `modelRange` and `modelCursor` is up to date after inserting new nodes into the model.
		updateConversionResult( image, data );
	}
}

function createImageViewElement( writer, modelElement, editor, consumable ) {
	if ( modelElement.is( 'element', 'imageInline' ) ) {
		return writer.createEmptyElement( 'img' );
	}

	const caption = modelElement.getChild( 0 );

	if ( caption ) {
		// consumable.consume( caption, 'insert' );
		console.log( editor.data.stringify( modelElement ) );
	}

	return writer.createEmptyElement( 'img' );
}

function modelEntityUuidToDataAttribute() {
	return dispatcher => {
		dispatcher.on( 'attribute:dataEntityUuid', converter );
	};

	function converter( evt, data, conversionApi ) {
		const { item } = data;
		const { consumable, writer } = conversionApi;

		if ( !consumable.consume( item, evt.name ) ) {
			return;
		}
q
		const viewElement = conversionApi.mapper.toViewElement( item );
		const imageInFigure = Array.from( viewElement.getChildren() ).find( child => child.name === 'img' );

		writer.setAttribute( 'data-entity-uuid', data.attributeNewValue, imageInFigure || viewElement );
	}
}

function modelEntityFileToDataAttribute() {
	return dispatcher => {
		dispatcher.on( 'attribute:dataEntityFile', converter );
	};

	function converter( evt, data, conversionApi ) {
		const { item } = data;
		const { consumable, writer } = conversionApi;

		if ( !consumable.consume( item, evt.name ) ) {
			return;
		}

		const viewElement = conversionApi.mapper.toViewElement( item );
		const imageInFigure = Array.from( viewElement.getChildren() ).find( child => child.name === 'img' );

		writer.setAttribute( 'data-entity-file', data.attributeNewValue, imageInFigure || viewElement );
	}
}
