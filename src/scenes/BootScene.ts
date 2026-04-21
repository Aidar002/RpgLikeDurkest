import * as Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
    constructor() {
        super('BootScene');
    }

    preload() {
        // Р—РґРµСЃСЊ РјС‹ Р±СѓРґРµРј Р·Р°РіСЂСѓР¶Р°С‚СЊ Р°СЃСЃРµС‚С‹ (РёРєРѕРЅРєРё РґР»СЏ РєР°СЂС‚С‹, С€СЂРёС„С‚С‹)
        // РџРѕРєР° РёСЃРїРѕР»СЊР·СѓРµРј РіСЂР°С„РёС‡РµСЃРєРёРµ РїСЂРёРјРёС‚РёРІС‹ Phaser
    }

    create() {
        // РџРµСЂРµС…РѕРґ РЅР° РѕСЃРЅРѕРІРЅСѓСЋ СЃС†РµРЅСѓ
        this.scene.start('GameScene');
    }
}
