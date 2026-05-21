export const DEMO_LOG = `66.0 APEX_CODE,FINEST;APEX_PROFILING,FINEST;DB,FINEST;SYSTEM,FINE;WORKFLOW,FINER
15:05:30.0 (100000)|USER_INFO|[EXTERNAL]|005xx000001|architect@example.com|(GMT-04:00) Eastern Daylight Time
15:05:30.0 (110000)|EXECUTION_STARTED
15:05:30.0 (120000)|CODE_UNIT_STARTED|[EXTERNAL]|apex://BREValidationController/ACTION$saveRecords
15:05:30.0 (130000)|CODE_UNIT_STARTED|[EXTERNAL]|01p000000001|BREValidationController.saveRecords(HUB_BRE_Result, String)
15:05:30.0 (160000)|METHOD_ENTRY|[173]|01p000000001|BREValidationController.saveRecords(HUB_BRE_Result, String)
15:05:30.0 (220000)|DML_BEGIN|[1062]|Op:Insert|Type:HUB_EligibilityStatus__c|Rows:1
15:05:30.0 (260000)|CODE_UNIT_STARTED|[EXTERNAL]|01q000000001|EligibilityStatusTrigger on HUB_EligibilityStatus trigger event AfterInsert|__sfdc_trigger/EligibilityStatusTrigger
15:05:30.0 (300000)|METHOD_ENTRY|[12]|01p000000002|HUB_EligibilityStatusSharing.handleEligibilityStatusInsert(List<HUB_EligibilityStatus__c>)
15:05:30.0 (360000)|DML_BEGIN|[43]|Op:Insert|Type:HUB_EligibilityStatus__Share|Rows:2
15:05:30.0 (430000)|DML_END|[43]
15:05:30.0 (450000)|METHOD_EXIT|[12]|HUB_EligibilityStatusSharing.handleEligibilityStatusInsert(List<HUB_EligibilityStatus__c>)
15:05:30.0 (460000)|CODE_UNIT_FINISHED|EligibilityStatusTrigger on HUB_EligibilityStatus trigger event AfterInsert|__sfdc_trigger/EligibilityStatusTrigger
15:05:30.0 (500000)|DML_END|[1062]
15:05:30.0 (530000)|DML_BEGIN|[2297]|Op:Update|Type:Case|Rows:1
15:05:30.0 (560000)|CODE_UNIT_STARTED|[EXTERNAL]|Flow:Case
15:05:30.0 (570000)|FLOW_CREATE_INTERVIEW_END|645-flow-1|Last Work Track
15:05:30.0 (600000)|FLOW_ELEMENT_BEGIN|645-flow-1|FlowDecision|check_flow_disabled
15:05:30.0 (650000)|FLOW_ELEMENT_END|645-flow-1|FlowDecision|check_flow_disabled
15:05:30.0 (680000)|FLOW_ELEMENT_BEGIN|645-flow-1|FlowRecordUpdate|Last_work_Update
15:05:30.0 (740000)|FLOW_ELEMENT_END|645-flow-1|FlowRecordUpdate|Last_work_Update
15:05:30.0 (780000)|FLOW_INTERVIEW_FINISHED|645-flow-1|Last Work Track
15:05:30.0 (800000)|FLOW_INTERVIEW_FINISHED_LIMIT_USAGE|SOQL queries: 7 out of 100
15:05:30.0 (810000)|FLOW_INTERVIEW_FINISHED_LIMIT_USAGE|DML statements: 3 out of 150
15:05:30.0 (820000)|FLOW_INTERVIEW_FINISHED_LIMIT_USAGE|CPU time in ms: 1104 out of 15000
15:05:30.0 (840000)|CODE_UNIT_FINISHED|Flow:Case
15:05:30.0 (880000)|CODE_UNIT_STARTED|[EXTERNAL]|01q000000002|CaseTrigger on Case trigger event BeforeUpdate|__sfdc_trigger/CaseTrigger
15:05:30.0 (920000)|METHOD_ENTRY|[94]|01p000000003|CasePatientDataAutomationService.applyBeforeSave(List<Case>, Map<Id,Case>)
15:05:30.0 (960000)|METHOD_ENTRY|[55]|01p000000003|CasePatientDataAutomationService.loadCaseContext(Set<Id>, Set<Id>)
15:05:30.0 (990000)|SOQL_EXECUTE_BEGIN|[388]|Aggregations:0|SELECT Id, RecordTypeId, AccountId, Status FROM Case WHERE Id = :tmpVar1
15:05:30.0 (1040000)|SOQL_EXECUTE_END|[388]|Rows:1
15:05:30.0 (1080000)|METHOD_EXIT|[55]|CasePatientDataAutomationService.loadCaseContext(Set<Id>, Set<Id>)
15:05:30.0 (1120000)|METHOD_EXIT|[94]|CasePatientDataAutomationService.applyBeforeSave(List<Case>, Map<Id,Case>)
15:05:30.0 (1160000)|CODE_UNIT_FINISHED|CaseTrigger on Case trigger event BeforeUpdate|__sfdc_trigger/CaseTrigger
15:05:30.0 (1200000)|CODE_UNIT_STARTED|[EXTERNAL]|01q000000002|CaseTrigger on Case trigger event AfterUpdate|__sfdc_trigger/CaseTrigger
15:05:30.0 (1240000)|METHOD_ENTRY|[365]|01p000000004|CaseDomain.onAfterUpdate(Map<Id,SObject>)
15:05:30.0 (1280000)|METHOD_ENTRY|[91]|01p000000005|StepRuleUpdateService.onRelatedRecordUpdate(Schema.SObjectType, Map<Id,SObject>, Map<Id,SObject>)
15:05:30.0 (1320000)|DML_BEGIN|[4667]|Op:Update|Type:HUB_StepCorrespondenceAudit__c|Rows:1
15:05:30.0 (1380000)|DML_END|[4667]
15:05:30.0 (1420000)|DML_BEGIN|[502]|Op:Insert|Type:HUB_SmsMessage__c|Rows:1
15:05:30.0 (1490000)|DML_END|[502]
15:05:30.0 (1530000)|METHOD_EXIT|[91]|StepRuleUpdateService.onRelatedRecordUpdate(Schema.SObjectType, Map<Id,SObject>, Map<Id,SObject>)
15:05:30.0 (1570000)|METHOD_EXIT|[365]|CaseDomain.onAfterUpdate(Map<Id,SObject>)
15:05:30.0 (1600000)|CODE_UNIT_FINISHED|CaseTrigger on Case trigger event AfterUpdate|__sfdc_trigger/CaseTrigger
15:05:30.0 (1650000)|DML_END|[2297]
15:05:30.0 (1700000)|METHOD_EXIT|[173]|BREValidationController.saveRecords(HUB_BRE_Result, String)
15:05:30.0 (1740000)|CODE_UNIT_FINISHED|BREValidationController.saveRecords(HUB_BRE_Result, String)
15:05:30.0 (1780000)|CODE_UNIT_FINISHED|apex://BREValidationController/ACTION$saveRecords
15:05:30.0 (1820000)|EXECUTION_FINISHED`;
