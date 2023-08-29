@isTest
public with sharing class fg_Manager_Test {
    @isTest
    public static void testStart(){
        fg_Manager.FlowInputs fi = new fg_Manager.FlowInputs();
        fg_Manager.start(new List<fg_Manager.FlowInputs>{fi});
    }

    @isTest
    public static void testGetCDBlob(){
        ContentVersion cv = new ContentVersion();
        cv.Title='Billy-Bob.txt';
        cv.PathOnClient='Billy-Bob.txt';
        cv.VersionData=EncodingUtil.base64Decode('Hello Motto');
        insert cv;
        String CDID = [SELECT ID FROM ContentDocument LIMIT1].Id;
        fg_Manager.getCDBlob(CDID);
    }

    @isTest
    public static void testInsertCV(){
        contact c = new contact(FirstName='Billy',LastName='Bob');
        insert c;
        fg_Manager.insertCV('Billy-Bob.txt','Hello Motto',c.Id);
    }
    
}
