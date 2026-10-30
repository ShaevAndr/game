import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ModifierDefinition, defaultModifierDefinitions, modifierDefinitionSchema } from '@game/core';
import { MongoDatabase } from '../../../infrastructure/mongo/mongo.service';
import { ModifierDefinitionsRepository } from '../ports/modifier-definitions.repository';
@Injectable()
export class MongoModifierDefinitionsRepository extends ModifierDefinitionsRepository implements OnModuleInit {
  constructor(@Inject(MongoDatabase) private readonly mongo: MongoDatabase) { super(); }
  async onModuleInit() {
    const collection = this.mongo.db.collection<ModifierDefinition>('modifierDefinitions');
    await this.mongo.db.command({ collMod: 'modifierDefinitions', validator: { $jsonSchema: {
      bsonType: 'object', required: ['allowSkill', 'allowWeapon', 'allowArmor'], properties: {
        allowSkill: { bsonType: 'bool' }, allowWeapon: { bsonType: 'bool' }, allowArmor: { bsonType: 'bool' },
      },
    } } }).catch(async error => {
      if (error.code !== 26) throw error;
      await this.mongo.db.createCollection('modifierDefinitions', { validator: { $jsonSchema: {
        bsonType: 'object', required: ['allowSkill', 'allowWeapon', 'allowArmor'], properties: {
          allowSkill: { bsonType: 'bool' }, allowWeapon: { bsonType: 'bool' }, allowArmor: { bsonType: 'bool' },
        },
      } } });
    });
    await collection.createIndex({ id: 1 }, { unique: true });
    for (const value of defaultModifierDefinitions) await collection.updateOne({ id: value.id }, { $setOnInsert: value }, { upsert: true });
  }
  async list() {
    return (await this.mongo.db.collection<ModifierDefinition>('modifierDefinitions').find({}, { projection: { _id: 0 } }).toArray()).map(value => modifierDefinitionSchema.parse(value));
  }
}
